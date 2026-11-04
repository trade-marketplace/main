import { beforeEach, describe, expect, it, vi } from "vitest";
import { boardJobHref } from "@/lib/job-board";
const deps = vi.hoisted(() => ({ viewer: vi.fn(), read: vi.fn() }));
vi.mock("@/server/auth/guard", () => ({ requireRole: deps.viewer }));
vi.mock("@/server/db", () => ({ getDb: () => ({}) }));
vi.mock("@/server/messages/service", () => ({ getMessages: deps.read, ProblemThreadError: class extends Error {} }));
vi.mock("@/components/messages/ProblemThreads", () => ({ ProblemThreads: () => null }));
const { default: List } = await import("@/app/(app)/messages/page");
const { default: Thread } = await import("@/app/(app)/messages/[threadId]/page");
const id = "00000000-0000-4000-8000-000000001005", other = "00000000-0000-4000-8000-000000001006", href = boardJobHref(id, "/jobs?kind=ready");
const data = () => ({ role: "TRADIE", viewerId: "worker", threads: [], selected: null, jobs: [{ id, title: "Job", number: "TM-1005" }] });
beforeEach(() => { vi.clearAllMocks(); deps.viewer.mockResolvedValue({ userId: "worker", role: "TRADIE" }); deps.read.mockResolvedValue(data()); });
describe("Messages claim return authorization", () => {
  it("preserves syntax-safe login context and passes only a serializable authorized return", async () => {
    const result = await List({ searchParams: Promise.resolve({ job: id, returnTo: href }) });
    expect(result.props.jobReturn).toBe(href); expect(result.props.threadHref).toBeUndefined();
    const next = new URL(deps.viewer.mock.calls[0][1].next, "https://local.test");
    expect(next.searchParams.get("returnTo")).toBe(href); expect(next.searchParams.get("job")).toBe(id);
    deps.read.mockResolvedValue({ ...data(), jobs: [] });
    expect((await List({ searchParams: Promise.resolve({ job: id, returnTo: href }) })).props.jobReturn).toBeNull();
  });
  it("keeps normal/customer Messages defaults and drops invalid context before Auth next", async () => {
    expect((await List({ searchParams: Promise.resolve({ job: id, returnTo: `${href}&posted=1` }) })).props.jobReturn).toBeNull();
    expect(deps.viewer.mock.calls[0][1].next).toBe("/messages");
    deps.viewer.mockResolvedValue({ userId: "customer", role: "CUSTOMER" });
    expect((await List({ searchParams: Promise.resolve({ job: id, returnTo: href }) })).props.jobReturn).toBeNull();
    expect((await List({ searchParams: Promise.resolve({}) })).props.jobReturn).toBeNull();
  });
  it("revalidates selected thread job ownership and preserves pagination context", async () => {
    const props = { params: Promise.resolve({ threadId: other }), searchParams: Promise.resolve({ returnTo: href, before: "cursor" }) };
    deps.read.mockResolvedValue({ ...data(), selected: { job: { id } } });
    expect((await Thread(props)).props.jobReturn).toBe(href);
    const next = new URL(deps.viewer.mock.calls[0][1].next, "https://local.test"); expect(next.searchParams.get("before")).toBe("cursor");
    deps.read.mockResolvedValue({ ...data(), selected: { job: { id: other } } });
    expect((await Thread(props)).props.jobReturn).toBeNull();
  });
});
