import "server-only";

import { z } from "zod";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { MAX_SAVED_ADDRESSES, parseAddress, type AddressInput, type AddressResult, type SavedAddress } from "@/lib/account/addresses";
import { createAudit } from "@/server/audit/audit";
import type { Viewer } from "@/server/auth/viewer";
import { databaseSchema } from "@/server/database-client";

type AddressViewer = Pick<Viewer, "userId" | "role">;
const select = { id: true, label: true, line1: true, line2: true, suburb: true, city: true, postcode: true, lat: true, lng: true, locationSource: true, isDefault: true, createdAt: true } as const;
type Row = Prisma.AddressGetPayload<{ select: typeof select }>;
const order = [{ isDefault: "desc" }, { createdAt: "desc" }, { id: "desc" }] as const;
const snapshot = (row: Pick<Row, "suburb" | "label"> | undefined) => row ? { suburb: row.suburb, label: row.label } : null;
const view = (rows: Row[]): SavedAddress[] => rows.map(row => ({ ...row, createdAt: row.createdAt.toISOString() }));
const readRows = (db: Pick<Prisma.TransactionClient, "address">, userId: string) => db.address.findMany({ where: { userId }, select, orderBy: [...order] });
const result = async (tx: Prisma.TransactionClient, userId: string): Promise<AddressResult> => ({ ok: true, addresses: view(await readRows(tx, userId)) });

export async function listAddresses(db: Pick<PrismaClient, "profile" | "address">, viewer: AddressViewer): Promise<SavedAddress[]> {
  if (viewer.role !== "CUSTOMER") return [];
  const person = await db.profile.findUnique({ where: { id: viewer.userId }, select: { role: true } });
  return person?.role === "CUSTOMER" ? view(await readRows(db, viewer.userId)) : [];
}

async function write(db: PrismaClient, viewer: AddressViewer, run: (tx: Prisma.TransactionClient, rows: Row[]) => Promise<AddressResult>): Promise<AddressResult> {
  if (viewer.role !== "CUSTOMER") return { ok: false, error: "forbidden" };
  try {
    const schema = databaseSchema(db).replaceAll('"', '""');
    const profiles = Prisma.raw(`"${schema}"."profiles"`), addresses = Prisma.raw(`"${schema}"."addresses"`);
    return await db.$transaction(async tx => {
      // Lock the parent too: locking an empty address set alone cannot serialize two first-address inserts.
      await tx.$queryRaw`SELECT id FROM ${profiles} WHERE id=${viewer.userId}::uuid FOR UPDATE`;
      const person = await tx.profile.findUnique({ where: { id: viewer.userId }, select: { role: true } });
      if (person?.role !== "CUSTOMER") return { ok: false, error: "forbidden" } as const;
      await tx.$queryRaw`SELECT id FROM ${addresses} WHERE user_id=${viewer.userId}::uuid ORDER BY id FOR UPDATE`;
      return run(tx, await readRows(tx, viewer.userId));
    }, { timeout: 10_000 });
  } catch { return { ok: false, error: "unavailable" }; }
}
function unchangedLocation(row: Row, input: AddressInput) {
  return row.line1 === input.line1 && row.suburb === input.suburb && row.city === input.city && (row.postcode ?? "") === input.postcode
    && row.lat === (input.point?.lat ?? null) && row.lng === (input.point?.lng ?? null);
}
export async function saveAddress(db: PrismaClient, viewer: AddressViewer, input: unknown): Promise<AddressResult> {
  if (viewer.role !== "CUSTOMER") return { ok: false, error: "forbidden" };
  const identifier = z.object({ id: z.uuid().optional(), requestId: z.uuid().optional() }).safeParse(input);
  if (!identifier.success) return { ok: false, error: "invalid" };
  return write(db, viewer, async (tx, rows) => {
    const requestedId = identifier.data.id ?? identifier.data.requestId;
    const old = rows.find(row => row.id === requestedId);
    if (identifier.data.id && !old) return { ok: false, error: "forbidden" };
    if (!identifier.data.id && requestedId && !old && await tx.address.findUnique({ where: { id: requestedId }, select: { id: true } })) return { ok: false, error: "forbidden" };
    const parsed = parseAddress(input);
    if (!parsed.ok) return parsed;
    const data = parsed.data;
    if (!old && rows.length >= MAX_SAVED_ADDRESSES) return { ok: false, error: "limit" };
    if (data.locationSource === null && (!old || !unchangedLocation(old, data))) return { ok: false, error: "invalid", fields: { line1: "Choose an address or type it by hand." } };
    const values = { label: data.label || null, line1: data.line1, line2: data.line2 || null, suburb: data.suburb, city: data.city, postcode: data.postcode || null,
      lat: data.point?.lat ?? null, lng: data.point?.lng ?? null, locationSource: data.locationSource ?? old!.locationSource };
    // The request UUID is the row UUID: a lost response can be retried without creating another address.
    if (old && rows.some(row => row.isDefault) && Object.entries(values).every(([key, value]) => old[key as keyof typeof values] === value)) return result(tx, viewer.userId);
    const saved = old ? await tx.address.update({ where: { id: old.id }, data: values, select })
      : await tx.address.create({ data: { id: data.requestId, userId: viewer.userId, ...values, isDefault: !rows.some(row => row.isDefault) }, select });
    await createAudit(tx)(viewer, "address.saved", { type: "profiles", id: viewer.userId }, snapshot(old), snapshot(saved));
    if (old && !rows.some(row => row.isDefault)) {
      const newest = rows[0].id === saved.id ? saved : rows[0];
      await tx.address.update({ where: { id: newest.id }, data: { isDefault: true } });
      await createAudit(tx)(viewer, "address.default_changed", { type: "profiles", id: viewer.userId }, null, snapshot(newest));
    }
    return result(tx, viewer.userId);
  });
}
export async function deleteAddress(db: PrismaClient, viewer: AddressViewer, id: unknown): Promise<AddressResult> {
  if (viewer.role !== "CUSTOMER") return { ok: false, error: "forbidden" };
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "invalid" };
  return write(db, viewer, async (tx, rows) => {
    const old = rows.find(row => row.id === id);
    if (!old) return { ok: false, error: "forbidden" };
    await tx.address.delete({ where: { id: old.id } });
    await createAudit(tx)(viewer, "address.deleted", { type: "profiles", id: viewer.userId }, snapshot(old), null);
    const remaining = rows.filter(row => row.id !== old.id);
    if (remaining.length && !remaining.some(row => row.isDefault)) {
      const promoted = remaining[0];
      await tx.address.update({ where: { id: promoted.id }, data: { isDefault: true } });
      await createAudit(tx)(viewer, "address.default_changed", { type: "profiles", id: viewer.userId }, snapshot(old), snapshot(promoted));
    }
    return result(tx, viewer.userId);
  });
}
export async function setDefaultAddress(db: PrismaClient, viewer: AddressViewer, id: unknown): Promise<AddressResult> {
  if (viewer.role !== "CUSTOMER") return { ok: false, error: "forbidden" };
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "invalid" };
  return write(db, viewer, async (tx, rows) => {
    const chosen = rows.find(row => row.id === id);
    if (!chosen) return { ok: false, error: "forbidden" };
    if (chosen.isDefault) return result(tx, viewer.userId);
    await tx.address.updateMany({ where: { userId: viewer.userId, isDefault: true }, data: { isDefault: false } });
    await tx.address.update({ where: { id: chosen.id }, data: { isDefault: true } });
    await createAudit(tx)(viewer, "address.default_changed", { type: "profiles", id: viewer.userId }, snapshot(rows.find(row => row.isDefault)), snapshot(chosen));
    return result(tx, viewer.userId);
  });
}
