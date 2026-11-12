import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { parseWorkArea, type WorkAreaInput, type WorkAreaResult, type WorkAreaSnapshot } from "@/lib/account/work-area";
import { createAudit } from "@/server/audit/audit";
import type { Viewer } from "@/server/auth/viewer";
import { hasCurrentTradeLicence } from "@/server/workers/verification";

type AreaViewer = Pick<Viewer, "userId" | "role">;

export async function loadWorkArea(db: Pick<PrismaClient, "profile">, viewer: AreaViewer, now = new Date()): Promise<WorkAreaSnapshot | null> {
  if (viewer.role !== "TRADIE") return null;
  const row = await db.profile.findUnique({ where: { id: viewer.userId }, select: { role: true, workerProfile: true,
    workerTrades: { select: { trade: true, licence: { select: { status: true, expiresOn: true, checkedAt: true, checkedById: true } } }, orderBy: { createdAt: "asc" } } } });
  if (row?.role !== "TRADIE" || !row.workerProfile) return null;
  const area = row.workerProfile;
  return { baseSuburb: area.baseSuburb ?? "", point: area.areaLat === null || area.areaLng === null ? null : { lat: area.areaLat, lng: area.areaLng },
    radiusKm: area.areaRadiusKm ?? 25, available: area.available, paused: area.pausedAt !== null,
    trades: row.workerTrades.filter(item => item.trade === "OTHER" || hasCurrentTradeLicence(row, item.trade, now)).map(item => item.trade) };
}

export async function saveWorkArea(db: PrismaClient, viewer: AreaViewer, input: WorkAreaInput): Promise<WorkAreaResult> {
  if (viewer.role !== "TRADIE") return { ok: false, error: "forbidden" };
  const parsed = parseWorkArea(input);
  if (!parsed.ok) return { ok: false, error: "invalid", fields: parsed.fields };
  return db.$transaction(async tx => {
    const current = await loadWorkArea(tx, viewer);
    if (!current || current.paused) return { ok: false as const, error: "forbidden" as const };
    const { baseSuburb, point, radiusKm } = parsed.data;
    await tx.workerProfile.update({ where: { userId: viewer.userId }, data: { baseSuburb, areaLat: point.lat, areaLng: point.lng, areaRadiusKm: radiusKm } });
    await createAudit(tx)(viewer, "worker.area_updated", { type: "worker_profiles", id: viewer.userId },
      { baseSuburb: current.baseSuburb, radiusKm: Number(current.radiusKm) }, { baseSuburb, radiusKm });
    return { ok: true as const, snapshot: { ...current, ...parsed.data } };
  }, { isolationLevel: "Serializable" });
}

export async function setAvailable(db: PrismaClient, viewer: AreaViewer, available: boolean): Promise<WorkAreaResult> {
  if (viewer.role !== "TRADIE" || typeof available !== "boolean") return { ok: false, error: "forbidden" };
  return db.$transaction(async tx => {
    const current = await loadWorkArea(tx, viewer);
    if (!current || current.paused) return { ok: false as const, error: "forbidden" as const };
    if (available) {
      const area = parseWorkArea(current);
      if (!area.ok) return { ok: false as const, error: "invalid" as const, fields: area.fields };
    }
    await tx.workerProfile.update({ where: { userId: viewer.userId }, data: { available } });
    await createAudit(tx)(viewer, "worker.availability_changed", { type: "worker_profiles", id: viewer.userId }, { available: current.available }, { available });
    return { ok: true as const, snapshot: { ...current, available } };
  }, { isolationLevel: "Serializable" });
}
