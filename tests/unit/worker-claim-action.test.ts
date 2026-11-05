import { beforeEach, describe, expect, it, vi } from "vitest";
const deps = vi.hoisted(() => ({ viewer: vi.fn(), command: vi.fn(), db: vi.fn(() => ({})) }));
vi.mock("@/server/auth/viewer", () => ({ getViewer: deps.viewer }));
vi.mock("@/server/db", () => ({ getDb: deps.db }));
vi.mock("@/server/jobs/worker-claim-command", () => ({ claimWorkerJob: deps.command }));
const { claimWorkerJobAction } = await import("@/server/jobs/worker-claim-actions");
beforeEach(() => { vi.clearAllMocks(); deps.command.mockResolvedValue({ status: "unavailable" }); });
describe("claim action authorization", () => {
  it("keeps expired sessions out of the database", async () => {
    deps.viewer.mockResolvedValue(null); expect(await claimWorkerJobAction("job")).toMatchObject({ error: "session-expired" }); expect(deps.db).not.toHaveBeenCalled();
  });
  it.each(["CUSTOMER", "ADMIN"])("refuses %s actors", async role => {
    deps.viewer.mockResolvedValue({ userId: "foreign", role }); expect(await claimWorkerJobAction("job")).toMatchObject({ error: "forbidden" }); expect(deps.command).not.toHaveBeenCalled();
  });
  it("passes only the current server actor to the command", async () => {
    const viewer = { userId: "real-worker", role: "TRADIE" }; deps.viewer.mockResolvedValue(viewer);
    await claimWorkerJobAction("job"); expect(deps.command).toHaveBeenCalledWith({}, viewer, "job");
  });
});
