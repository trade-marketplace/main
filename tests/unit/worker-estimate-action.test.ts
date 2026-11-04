import { beforeEach, describe, expect, it, vi } from "vitest";
const deps = vi.hoisted(() => ({ viewer: vi.fn(), submit: vi.fn(), db: vi.fn(() => ({})) }));
vi.mock("@/server/auth/viewer", () => ({ getViewer: deps.viewer }));
vi.mock("@/server/db", () => ({ getDb: deps.db }));
vi.mock("@/server/jobs/worker-estimate", () => ({ submitWorkerEstimate: deps.submit }));
const { saveWorkerEstimateAction } = await import("@/server/jobs/worker-estimate-actions");
beforeEach(() => { vi.clearAllMocks(); deps.submit.mockResolvedValue({ status: "saved" }); });
describe("estimate server action authorization", () => {
  it("returns the shared session-expired result without touching the database", async () => {
    deps.viewer.mockResolvedValue(null); expect(await saveWorkerEstimateAction("job", {})).toMatchObject({ error: "session-expired" }); expect(deps.db).not.toHaveBeenCalled();
  });
  it.each(["CUSTOMER", "ADMIN"])("refuses a %s caller", async role => {
    deps.viewer.mockResolvedValue({ userId: "foreign", role }); expect(await saveWorkerEstimateAction("job", {})).toMatchObject({ error: "forbidden" }); expect(deps.submit).not.toHaveBeenCalled();
  });
  it("uses the current verified viewer rather than any identity inside the input", async () => {
    const viewer = { userId: "actual-worker", role: "TRADIE" }; deps.viewer.mockResolvedValue(viewer);
    const input = { workerId: "forged-worker" }; await saveWorkerEstimateAction("job", input);
    expect(deps.submit).toHaveBeenCalledWith({}, viewer, "job", input);
  });
});
