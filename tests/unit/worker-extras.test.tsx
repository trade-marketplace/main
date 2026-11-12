import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ExtraWorkCard } from "@/components/jobs/worker/ExtraWorkCard";
import { extraErrors, extraRequest, type WorkerExtra } from "@/lib/worker-extras";
import { loadWorkerExtras } from "@/server/jobs/worker-extras";
import type { PrismaClient } from "@/generated/prisma/client";
const fields = { description: "Replace a second broken switch.", hours: "0.5" };
const sample: WorkerExtra = { id: "extra", description: fields.description, status: "REQUESTED", requestedMinutes: 30, minutes: null, workerEarnsCents: null, photoCount: 1, createdAt: "2026-11-12T00:00:00Z" };
describe("worker extra work", () => {
  it("requires description, whole-minute hours and 1 to 6 completed photos", () => {
    expect(extraErrors(fields, 1)).toEqual({});
    for (const hours of ["", "0", "-1", "NaN", "Infinity", "100.01", "0.001"]) expect(extraErrors({ ...fields, hours }, 1).hours).toBeTruthy();
    expect(extraErrors({ ...fields, hours: String(1 / 60) }, 1)).toEqual({});
    expect(extraErrors({ ...fields, description: "short" }, 1).description).toBeTruthy();
    expect(extraErrors({ ...fields, description: "a".repeat(2001) }, 1).description).toBeTruthy();
    expect(extraErrors(fields, 0).photos).toBeTruthy(); expect(extraErrors(fields, 7).photos).toBeTruthy();
  });
  it("keeps the same request key and payload on retries without sharing a mutable photo list", () => {
    const photos = ["private-path"], key = "16000000-0000-4000-8000-000000000001";
    const first = extraRequest("job", key, fields, photos), retry = extraRequest("job", key, fields, photos);
    expect(first).toEqual(retry); photos.push("later"); expect(first.photoPaths).toEqual(["private-path"]);
    expect(Object.keys(first).sort()).toEqual(["jobId", "requestKey", "description", "hours", "photoPaths"].sort());
  });
  it.each([['REQUESTED', "Extra work sent. We’re pricing it."], ['PRICED', "Waiting on Sarah’s OK."], ['APPROVED', "Extra work approved."], ['DECLINED', "Sarah said no to the extra work. Finish the original job only."]] as const)("shows %s using worker earnings only", (status, message) => {
    const html = renderToStaticMarkup(<ExtraWorkCard extra={{ ...sample, status, workerEarnsCents: status === "REQUESTED" ? null : 6400 }} customerFirstName="Sarah" />);
    expect(html).toContain(message); expect(html).not.toMatch(/priceCents|gstCents|margin|You earn/);
    if (status === "PRICED" || status === "APPROVED") expect(html).toContain("Earn +$64.00");
  });
  it("does not select customer-price columns and projects exactly the worker payload", async () => {
    const findMany = vi.fn(async () => [{ id: "one", status: "PRICED", description: fields.description, requestedMinutes: 30, minutes: 45, workerGrossCents: 6000, holidayPayCents: 480, createdAt: new Date(sample.createdAt), _count: { photos: 2 } }]);
    const db = { profile: { findUnique: async () => ({ role: "TRADIE" }) }, variation: { findMany } } as unknown as PrismaClient;
    const result = await loadWorkerExtras(db, { userId: "16000000-0000-4000-8000-000000000001", role: "TRADIE" }, "16000000-0000-4000-8000-000000000002");
    expect(Object.keys(result[0]).sort()).toEqual(["id", "status", "description", "requestedMinutes", "minutes", "workerEarnsCents", "photoCount", "createdAt"].sort());
    expect(result[0].workerEarnsCents).toBe(6480);
    expect(JSON.stringify(findMany.mock.calls)).not.toMatch(/priceCents|gstCents|marginCents|onCostCents|materialsCents/);
  });
});
