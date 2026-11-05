import { Suspense } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { exampleJob, VIEWERS } from "@/app/dev/components/job-views/preview-data";
import type { JobSource } from "@/server/views";
const deps = vi.hoisted(() => ({ viewer: vi.fn(), find: vi.fn() }));
vi.mock("@/server/auth/guard", () => ({ requireUser: deps.viewer }));
vi.mock("@/server/db", () => ({ getDb: () => ({ job: { findUnique: deps.find } }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw Error("not-found"); } }));
vi.mock("@/components/jobs/WorkerClaim", () => ({ WorkerClaimLoading: () => null, WorkerClaimLoadError: () => null }));
vi.mock("@/components/jobs/WorkerClaimPage", () => ({ WorkerClaimPage: () => null }));
vi.mock("@/components/jobs/WorkerEstimatePage", () => ({ WorkerEstimatePage: () => null }));
vi.mock("@/components/jobs/WorkerJobBoundary", () => ({ WorkerJobLoading: () => null, WorkerJobLoadError: () => null }));
vi.mock("@/components/jobs/CustomerJobPage", () => ({ CustomerJobPage: () => null }));
vi.mock("@/components/jobs/CustomerJob", () => ({ CustomerJobLoading: () => null, CustomerJobLoadError: () => null }));
const { default: JobPage } = await import("@/app/(app)/jobs/[id]/page");
const { WorkerClaimPage } = await import("@/components/jobs/WorkerClaimPage");
const { WorkerEstimatePage } = await import("@/components/jobs/WorkerEstimatePage");
async function page(source: JobSource | null) {
  deps.find.mockResolvedValue(source);
  return JobPage({ params: Promise.resolve({ id: exampleJob().id }), searchParams: Promise.resolve({ from: "/jobs?kind=ready" }) });
}
beforeEach(() => { vi.clearAllMocks(); deps.viewer.mockResolvedValue(VIEWERS.worker); });
describe("owned claim result routing", () => {
  it("keeps a frozen ASSIGNED result on reload with its validated board return", async () => {
    const result = await page(exampleJob());
    expect(result.type).toBe(Suspense);
    expect(result.props.children.type).toBe(WorkerClaimPage);
    expect(result.props.children.props).toMatchObject({ viewer: VIEWERS.worker, id: exampleJob().id, back: "/jobs?kind=ready" });
  });
  it("preserves the readable legacy assigned summary when frozen pricing is absent", async () => {
    const result = await page(exampleJob({ pricing: null }));
    expect(result.type).toBe(Suspense);
    expect(result.props.children.type).toBe(WorkerEstimatePage);
    expect(result.props.children.props).toMatchObject({ viewer: VIEWERS.worker, id: exampleJob().id, back: "/jobs?kind=ready" });
  });
  it("rejects a foreign assignment before rendering or streaming a result", async () => {
    await expect(page(exampleJob({ workerId: "00000000-0000-4000-8000-000000000088" }))).rejects.toThrow("not-found");
    expect(deps.find).toHaveBeenCalledTimes(1);
  });
});
