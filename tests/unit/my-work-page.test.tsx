import { beforeEach, describe, expect, it, vi } from "vitest";
import Dashboard, { generateMetadata } from "@/app/(app)/dashboard/page";
import { CustomerJobs } from "@/components/jobs/CustomerJobs";
import { MyWork } from "@/components/mywork/MyWork";
import { requireRole } from "@/server/auth/guard";
import { getViewer } from "@/server/auth/viewer";
import { getDb } from "@/server/db";
import { loadMyQuotes, loadMyWork } from "@/server/workers/my-work";
import { previewQuotes, previewWork } from "@/app/dev/components/my-work/preview-data";

vi.mock("next/navigation", () => ({ unstable_rethrow: vi.fn() }));
vi.mock("@/server/auth/guard", () => ({ requireRole: vi.fn() }));
vi.mock("@/server/auth/viewer", () => ({ getViewer: vi.fn() }));
vi.mock("@/server/db", () => ({ getDb: vi.fn(() => ({})) }));
vi.mock("@/server/workers/my-work", () => ({ loadMyWork: vi.fn(), loadMyQuotes: vi.fn() }));
vi.mock("@/server/customer-jobs", () => ({ listCustomerJobs: vi.fn(async () => null) }));
vi.mock("@/components/mywork/MyWork", () => ({ MyWork: () => null }));
vi.mock("@/components/jobs/CustomerJobs", () => ({ CustomerJobs: () => null }));
const worker = { userId: "worker", role: "TRADIE" as const, firstName: "Jack", email: "worker@example.test", emailVerified: true };
beforeEach(() => { vi.clearAllMocks(); vi.mocked(requireRole).mockResolvedValue(worker); vi.mocked(getViewer).mockResolvedValue(worker); vi.mocked(getDb).mockReturnValue({} as ReturnType<typeof getDb>); vi.mocked(loadMyWork).mockResolvedValue(previewWork("full")); vi.mocked(loadMyQuotes).mockResolvedValue(previewQuotes()); });
describe("role-shared dashboard", () => {
  it("keeps the existing customer reader, query and UI branch", async () => {
    vi.mocked(requireRole).mockResolvedValue({ ...worker, role: "CUSTOMER" });
    const route = await Dashboard({ searchParams: Promise.resolve({ tab: "done", q: "tap", page: "2" }) });
    const child = route.props.children, result = await child.type(child.props);
    expect(result.type).toBe(CustomerJobs); expect(result.props.query).toEqual({ tab: "done", q: "tap", page: 2 });
    expect(loadMyWork).not.toHaveBeenCalled(); expect(loadMyQuotes).not.toHaveBeenCalled();
    expect(requireRole).toHaveBeenCalledWith(["CUSTOMER", "TRADIE"], { next: "/dashboard?tab=done&q=tap&page=2" });
  });
  it("preserves the worker tab/column through the independent page guard and fallback", async () => {
    const route = await Dashboard({ searchParams: Promise.resolve({ tab: "quotes", column: "done" }) });
    expect(requireRole).toHaveBeenCalledWith(["CUSTOMER", "TRADIE"], { next: "/dashboard?tab=quotes&column=done" });
    expect(route.props.fallback.props.query).toEqual({ tab: "quotes", column: "done" });
    const child = route.props.children, result = await child.type(child.props);
    expect(result.type).toBe(MyWork); expect(result.props.work.jobsOn).toBe(3);
  });
  it.each([["TRADIE", "My work"], ["CUSTOMER", "My jobs"]] as const)("sets the %s page title", async (role, title) => {
    vi.mocked(getViewer).mockResolvedValue({ ...worker, role }); expect((await generateMetadata()).title).toBe(title);
  });
  it("shows an owned retry state when database setup fails, without logging raw details", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      vi.mocked(getDb).mockImplementation(() => { throw Error("Private database detail"); });
      const route = await Dashboard({ searchParams: Promise.resolve({}) }); const child = route.props.children, result = await child.type(child.props);
      expect(result.type).toBe(MyWork); expect(result.props.work).toBeNull(); expect(result.props.quotes).toBeNull();
      expect(log).toHaveBeenCalledWith("My work could not load jobs or quotes.");
    } finally { log.mockRestore(); }
  });
  it("retains jobs when the independent quote-history read fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      vi.mocked(loadMyQuotes).mockRejectedValue(Error("Unavailable"));
      const route = await Dashboard({ searchParams: Promise.resolve({}) }); const child = route.props.children, result = await child.type(child.props);
      expect(result.props.work.jobsOn).toBe(3); expect(result.props.quotes).toBeNull();
    } finally { log.mockRestore(); }
  });
});
