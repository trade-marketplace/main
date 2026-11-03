import { beforeEach, describe, expect, it, vi } from "vitest";
import Page from "@/app/admin/page";
import { requireRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { getOfficeQueueStats, readOfficeQueues } from "@/server/office/queues";

vi.mock("@/server/auth/guard", () => ({ requireRole: vi.fn() }));
vi.mock("@/server/db", async original => ({ ...(await original<typeof import("@/server/db")>()), getDb: vi.fn() }));
vi.mock("@/server/office/queues", () => ({ getOfficeQueueStats: vi.fn(), readOfficeQueues: vi.fn() }));
const viewer = { userId: "office", role: "ADMIN", email: "office@example.test", firstName: "Matt", emailVerified: true } as const;
beforeEach(() => { vi.clearAllMocks(); vi.mocked(requireRole).mockResolvedValue(viewer); });

describe("the real queues page boundary", () => {
  it("authorizes before any queue read and preserves the query in its return path", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("redirect"));
    await expect(Page({ searchParams: Promise.resolve({ tab: "extra", q: "Sarah" }) })).rejects.toThrow("redirect");
    expect(requireRole).toHaveBeenCalledWith(["ADMIN"], { next: "/admin?tab=extra&q=Sarah" });
    expect(getDb).not.toHaveBeenCalled(); expect(getOfficeQueueStats).not.toHaveBeenCalled();
  });
  it("passes only the verified actor and parsed URL query into the actual read", async () => {
    vi.mocked(readOfficeQueues).mockResolvedValueOnce({ rows: [] } as never);
    const element = await Page({ searchParams: Promise.resolve({ tab: "cancel", q: "TM-1005" }) });
    expect(element.props.query).toMatchObject({ tab: "cancel", q: "TM-1005", page: 1 });
    expect(vi.mocked(readOfficeQueues).mock.calls[0][1]).toEqual(viewer);
  });
  it("renders a failure instead of all-clear and never logs search/customer data from an exception", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(readOfficeQueues).mockRejectedValueOnce(new Error("private-query@example.test"));
    const element = await Page({ searchParams: Promise.resolve({}) });
    expect(element.props.data).toBeNull();
    expect(JSON.stringify(log.mock.calls)).not.toContain("private-query@example.test");
    log.mockRestore();
  });
});
