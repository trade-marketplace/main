import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { claimExtraDialog, type CustomerExtra } from "@/lib/customer-extras";
import { loadCustomerExtras } from "@/server/jobs/customer-extras";
import { ExtraWorkDialog } from "@/components/jobs/customer/ExtraWorkDialog";
import type { PrismaClient } from "@/generated/prisma/client";

const dialog = vi.hoisted(() => vi.fn());
vi.mock("@/components/overlays/Dialog", () => ({ Dialog: (props: Record<string, unknown>) => { dialog(props); return null; } }));
const extra: CustomerExtra = { id: "00000000-0000-4000-8000-000000000002", revision: 2, status: "PRICED", description: "Replace the breaker", priceCents: 14800, photoCount: 1, pricedAt: null, decidedAt: null };
describe("customer extra work", () => {
  it("opens once per variation revision without sharing an old revision's acknowledgement", () => {
    const entries = new Map<string, string>();
    const storage = { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value); } };
    expect(claimExtraDialog(extra.id, 2, storage)).toBe(true);
    expect(claimExtraDialog(extra.id, 2, storage)).toBe(false);
    expect(claimExtraDialog(extra.id, 3, storage)).toBe(true);
    expect([...entries.keys()]).toEqual([`tm:extra-seen:${extra.id}:2`, `tm:extra-seen:${extra.id}:3`]);
  });
  it("keeps extra work available if session storage is unavailable", () => {
    expect(claimExtraDialog(extra.id, 2, { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } })).toBe(true);
  });
  it("uses the kit heading focus without overriding it with Approve", () => {
    const noop = () => {};
    renderToStaticMarkup(<ExtraWorkDialog extra={extra} name="Jack" open confirm={false} busy={null} online error={null} photos={[]} photosLoading={false} photosFailed={false} onPhotoClose={noop} onRetryPhotos={noop} onClose={noop} onConfirm={noop} onBack={noop} onDecline={noop} onPay={noop} />);
    expect(dialog).toHaveBeenLastCalledWith(expect.objectContaining({ title: "Jack found extra work" }));
    expect(renderToStaticMarkup(dialog.mock.lastCall?.[0].eyebrow)).toContain("Needs your OK");
    expect(dialog.mock.lastCall?.[0]).not.toHaveProperty("initialFocusRef");
  });
  it("keeps waiting rows, fills the remaining spaces, and returns only eight customer fields", async () => {
    const row = { ...extra, createdAt: new Date("2026-11-10T00:00:00Z"), pricedAt: new Date("2026-11-12T00:00:00Z"), _count: { photos: 1 }, requestedMinutes: 60, materialsCents: 123, workerGrossCents: 456, marginCents: 789 };
    const decided = { ...row, id: "00000000-0000-4000-8000-000000000004", status: "DECLINED", createdAt: new Date("2026-11-11T00:00:00Z") };
    const findMany = vi.fn().mockResolvedValueOnce([row]).mockResolvedValueOnce([decided]);
    const result = await loadCustomerExtras({ variation: { findMany } } as unknown as Pick<PrismaClient, "variation">, { userId: "00000000-0000-4000-8000-000000000001", role: "CUSTOMER" }, "00000000-0000-4000-8000-000000000003");
    expect(result.map(item => item.id)).toEqual([decided.id, row.id]);
    for (const item of result) expect(Object.keys(item).sort()).toEqual(["id", "revision", "status", "description", "priceCents", "photoCount", "pricedAt", "decidedAt"].sort());
    for (const [query] of findMany.mock.calls) {
      expect(Object.keys(query.select).sort()).toEqual(["id", "revision", "status", "description", "priceCents", "pricedAt", "decidedAt", "createdAt", "_count"].sort());
      expect(query.where).toMatchObject({ jobId: "00000000-0000-4000-8000-000000000003", job: { customerId: "00000000-0000-4000-8000-000000000001", customer: { role: "CUSTOMER" }, status: "ASSIGNED" } });
    }
    expect(findMany.mock.calls[0][0]).not.toHaveProperty("take");
    expect(findMany.mock.calls[0][0].where.status).toEqual({ in: ["REQUESTED", "PRICED"] });
    expect(findMany.mock.calls[1][0]).toMatchObject({ take: 4, where: { status: { in: ["APPROVED", "DECLINED"] }, id: { notIn: [row.id] } } });
  });
  it("does not read for signed-out, other-role or invalid identifiers", async () => {
    const findMany = vi.fn();
    const db = { variation: { findMany } } as unknown as Pick<PrismaClient, "variation">;
    const id = "00000000-0000-4000-8000-000000000001";
    for (const viewer of [null, { userId: id, role: "TRADIE" as const }, { userId: "bad", role: "CUSTOMER" as const }]) expect(await loadCustomerExtras(db, viewer, id)).toEqual([]);
    expect(await loadCustomerExtras(db, { userId: id, role: "CUSTOMER" }, "bad")).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});
