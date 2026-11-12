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
  it("selects and returns only the eight customer fields with a five-row bound", async () => {
    const findMany = vi.fn(async (query: { select: Record<string, unknown> }) => { void query; return [{ ...extra, pricedAt: new Date("2026-11-12T00:00:00Z"), _count: { photos: 1 }, requestedMinutes: 60, materialsCents: 123, workerGrossCents: 456, marginCents: 789 }]; });
    const result = await loadCustomerExtras({ variation: { findMany } } as unknown as Pick<PrismaClient, "variation">, { userId: "00000000-0000-4000-8000-000000000001", role: "CUSTOMER" }, "00000000-0000-4000-8000-000000000003");
    expect(Object.keys(result[0]).sort()).toEqual(["id", "revision", "status", "description", "priceCents", "photoCount", "pricedAt", "decidedAt"].sort());
    expect(Object.keys(findMany.mock.calls[0][0].select).sort()).toEqual(["id", "revision", "status", "description", "priceCents", "pricedAt", "decidedAt", "_count"].sort());
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 5, where: { jobId: "00000000-0000-4000-8000-000000000003", job: { customerId: "00000000-0000-4000-8000-000000000001", customer: { role: "CUSTOMER" }, status: "ASSIGNED" } } }));
  });
});
