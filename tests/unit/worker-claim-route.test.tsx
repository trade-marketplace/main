import { Suspense } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { exampleJob, VIEWERS } from "@/app/dev/components/job-views/preview-data";
import type { JobSource } from "@/server/views";
const deps = vi.hoisted(() => ({ viewer: vi.fn(), find: vi.fn() }));
vi.mock("@/server/auth/guard", () => ({ requireUser: deps.viewer }));
vi.mock("@/server/db", () => ({ getDb: () => ({ job: { findUnique: deps.find } }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw Error("not-found"); } }));
vi.mock("@/components/jobs/worker/Workspace", () => ({ WorkspaceLoading: () => null }));
vi.mock("@/components/jobs/worker/WorkspacePage", () => ({ WorkspacePage: () => null }));
vi.mock("@/components/jobs/WorkerClaim", () => ({ WorkerClaimLoading: () => null, WorkerClaimLoadError: () => null }));
vi.mock("@/components/jobs/WorkerClaimPage", () => ({ WorkerClaimPage: () => null }));
vi.mock("@/components/jobs/WorkerEstimatePage", () => ({ WorkerEstimatePage: () => null }));
vi.mock("@/components/jobs/WorkerJobBoundary", () => ({ WorkerJobLoading: () => null, WorkerJobLoadError: () => null }));
vi.mock("@/components/jobs/CustomerJobPage", () => ({ CustomerJobPage: () => null }));
vi.mock("@/components/jobs/CustomerJob", () => ({ CustomerJobLoading: () => null, CustomerJobLoadError: () => null }));
const { default: JobPage } = await import("@/app/(app)/jobs/[id]/page");
const { WorkerClaimPage } = await import("@/components/jobs/WorkerClaimPage");
const { WorkspacePage } = await import("@/components/jobs/worker/WorkspacePage");
async function page(source: JobSource | null) {
  deps.find.mockResolvedValue(source);
  return JobPage({ params: Promise.resolve({ id: exampleJob().id }), searchParams: Promise.resolve({ from: "/jobs?kind=ready" }) });
}
beforeEach(() => { vi.clearAllMocks(); deps.viewer.mockResolvedValue(VIEWERS.worker); });
describe("owned claim result routing", () => {
  it("forwards the existing bounded My work context into the workspace and its loading fallback", async () => {
    deps.find.mockResolvedValue(exampleJob());
    const result = await JobPage({ params: Promise.resolve({ id: exampleJob().id }), searchParams: Promise.resolve({ from: "/dashboard?tab=quotes&column=on-now" }) });
    expect(result.props.children.props.back).toBe("/dashboard?tab=quotes&column=on-now");
    expect(result.props.fallback.props.myWorkHref).toBe("/dashboard?tab=quotes&column=on-now");
  });
  it("opens the owned ASSIGNED workspace on reload", async () => {
    const result = await page(exampleJob());
    expect(result.type).toBe(Suspense);
    expect(result.props.children.type).toBe(WorkspacePage);
    expect(result.props.children.props).toMatchObject({ viewer: VIEWERS.worker, id: exampleJob().id });
  });
  it("opens the legacy owned workspace without inventing frozen earnings", async () => {
    const result = await page(exampleJob({ pricing: null }));
    expect(result.type).toBe(Suspense);
    expect(result.props.children.type).toBe(WorkspacePage);
    expect(result.props.children.props).toMatchObject({ viewer: VIEWERS.worker, id: exampleJob().id });
  });
  it("keeps BOOKABLE on the claim page", async () => {
    const result = await page(exampleJob({ status: "BOOKABLE", workerId: null }));
    expect(result.props.children.type).toBe(WorkerClaimPage);
  });
  it.each(["SUBMITTED", "COMPLETED", "CANCEL_REVIEW"] as const)("opens the owned %s workspace", async status => {
    const result = await page(exampleJob({ status }));
    expect(result.props.children.type).toBe(WorkspacePage);
  });
  it("rejects a foreign assignment before rendering or streaming a result", async () => {
    await expect(page(exampleJob({ workerId: "00000000-0000-4000-8000-000000000088" }))).rejects.toThrow("not-found");
    expect(deps.find).toHaveBeenCalledTimes(1);
  });
});
