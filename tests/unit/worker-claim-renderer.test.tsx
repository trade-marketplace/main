import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Trade } from "@/generated/prisma/enums";
import { exampleJob, VIEWERS } from "@/app/dev/components/job-views/preview-data";

const deps = vi.hoisted(() => ({ load: vi.fn(), contact: vi.fn(), photos: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), notFound: () => { throw Error("not-found"); } }));
vi.mock("@/server/db", () => ({ getDb: () => ({}) }));
vi.mock("@/server/files/service", () => ({ getUploadService: () => ({ jobPhotoUrls: deps.photos }) }));
vi.mock("@/server/messages/contact", () => ({ problemContactHref: deps.contact }));
vi.mock("@/server/jobs/worker-claim-actions", () => ({ claimWorkerJobAction: vi.fn() }));
vi.mock("@/server/jobs/worker-claim-reader", async importOriginal => ({ ...await importOriginal<typeof import("@/server/jobs/worker-claim-reader")>(), loadWorkerClaim: deps.load }));
const { WorkerClaim } = await import("@/components/jobs/WorkerClaim");
const { WorkerClaimPage } = await import("@/components/jobs/WorkerClaimPage");
const { workerClaimView } = await import("@/server/jobs/worker-claim-reader");
const needs = { cocRequired: false, minPhotos: 0, notesRequired: false };
beforeEach(() => { vi.clearAllMocks(); });

describe("claim materials guidance", () => {
  it.each(Object.values(Trade))("keeps %s within its decided procurement policy", category => {
    const job = workerClaimView(VIEWERS.worker, exampleJob({ category, status: "BOOKABLE", workerId: null }), needs)!;
    for (const preview of [undefined, "confirm", "success"]) {
      const html = renderToStaticMarkup(<WorkerClaim job={job} back="/jobs?kind=ready" preview={preview} />);
      expect(html).toContain("Materials budget");
      expect(html.includes("Materials budget (Telfer)")).toBe(category === "ELECTRICAL");
      if (category !== "ELECTRICAL") expect(html).not.toContain("Telfer");
      if (preview === "success") {
        expect(html).toContain("Book one of the customer’s time windows");
        expect(html).toContain("Do the work, send completion evidence");
        expect(html.includes("Grab materials at Telfer")).toBe(category === "ELECTRICAL");
      }
    }
  });
});

describe("owned claim server rendering", () => {
  it("resolves the existing conversation only after the canonical reader unlocks ownership", async () => {
    const job = workerClaimView(VIEWERS.worker, exampleJob(), needs)!;
    deps.load.mockResolvedValue({ job, photoCount: 0, failure: null });
    const threadHref = "/messages/14400000-0000-4000-8000-000000000044";
    deps.contact.mockResolvedValue(threadHref);
    const result = await WorkerClaimPage({ viewer: VIEWERS.worker, id: job.id, back: "/jobs?kind=ready" });
    expect(deps.contact).toHaveBeenCalledExactlyOnceWith({}, VIEWERS.worker, job.id);
    expect(deps.load.mock.invocationCallOrder[0]).toBeLessThan(deps.contact.mock.invocationCallOrder[0]);
    const html = renderToStaticMarkup(result);
    expect(html).toContain(`${threadHref}?returnTo=`);
    expect(html).toContain("1 Example Street");
    expect(html).not.toContain("/messages?job=");
    expect(deps.photos).not.toHaveBeenCalled();
  });
  it("does not look up conversations or expose contacts for an unclaimed job", async () => {
    const job = workerClaimView(VIEWERS.worker, exampleJob({ status: "BOOKABLE", workerId: null }), needs)!;
    deps.load.mockResolvedValue({ job, photoCount: 0, failure: null });
    const html = renderToStaticMarkup(await WorkerClaimPage({ viewer: VIEWERS.worker, id: job.id, back: "/jobs" }));
    expect(deps.contact).not.toHaveBeenCalled();
    expect(html).not.toContain("1 Example Street"); expect(html).not.toContain("0210000001");
  });
  it("keeps missing or unauthorized jobs at 404 without resolving a conversation", async () => {
    deps.load.mockResolvedValue(null);
    await expect(WorkerClaimPage({ viewer: VIEWERS.worker, id: exampleJob().id, back: "/jobs" })).rejects.toThrow("not-found");
    expect(deps.contact).not.toHaveBeenCalled(); expect(deps.photos).not.toHaveBeenCalled();
  });
});
