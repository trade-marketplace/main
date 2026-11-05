import { beforeEach, describe, expect, it, vi } from "vitest";
import InboxPage from "@/app/admin/support/page";
import ThreadPage from "@/app/admin/support/[threadId]/page";
import { requireRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { getOfficeSupport, listOfficeSupport } from "@/server/office/support";
import { previewConversation } from "@/app/dev/components/office-support/preview-data";

vi.mock("@/server/auth/guard", () => ({ requireRole: vi.fn() }));
vi.mock("@/server/db", () => ({ getDb: vi.fn(() => ({})) }));
vi.mock("@/server/office/support", () => ({ listOfficeSupport: vi.fn(), getOfficeSupport: vi.fn() }));
vi.mock("@/components/office/OfficeSupport", () => ({ OfficeSupportInbox: vi.fn(), OfficeSupportConversation: vi.fn() }));
const viewer = { userId: "office", role: "ADMIN", email: "office@example.test", firstName: "Matt", emailVerified: true } as const;
const id = "00000000-0000-4000-8000-000000001830", cursor = "00000000-0000-4000-8000-000000001834";
beforeEach(() => { vi.clearAllMocks(); vi.mocked(requireRole).mockResolvedValue(viewer); });
describe("office support route boundaries", () => {
  it("authorizes before any inbox read and keeps only bounded search state in the login return path", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("redirect"));
    await expect(InboxPage({ searchParams: Promise.resolve({ status: "all", q: "Sarah", page: "2", returnTo: "https://evil.test" }) })).rejects.toThrow("redirect");
    expect(requireRole).toHaveBeenCalledWith(["ADMIN"], { next: "/admin/support?status=all&q=Sarah&page=2" });
    expect(getDb).not.toHaveBeenCalled(); expect(listOfficeSupport).not.toHaveBeenCalled();
  });
  it("preserves the actual private history cursor and passes only the verified actor to its read", async () => {
    vi.mocked(getOfficeSupport).mockResolvedValueOnce(previewConversation("conversation"));
    await ThreadPage({ params: Promise.resolve({ threadId: id }), searchParams: Promise.resolve({ before: cursor, q: "Sarah", page: "2" }) });
    expect(requireRole).toHaveBeenCalledWith(["ADMIN"], { next: `/admin/support/${id}?q=Sarah&page=2&before=${cursor}` });
    expect(getOfficeSupport).toHaveBeenCalledWith({}, viewer, id, cursor);
  });
  it("redirects shared threads to the real office job messages with their bounded visible Back context", async () => {
    vi.mocked(getOfficeSupport).mockResolvedValueOnce({ kind: "job", jobId: id });
    await expect(ThreadPage({ params: Promise.resolve({ threadId: id }), searchParams: Promise.resolve({ status: "all", q: "Sarah", page: "2" }) })).rejects.toMatchObject({ digest: expect.stringContaining(`/admin/jobs/${id}?status=all&q=Sarah&page=2&from=support#job-messages`) });
  });
  it("rejects malformed and missing thread ids without exposing another conversation", async () => {
    await expect(ThreadPage({ params: Promise.resolve({ threadId: "invalid" }), searchParams: Promise.resolve({}) })).rejects.toMatchObject({ digest: expect.stringContaining("404") });
    expect(getOfficeSupport).not.toHaveBeenCalled();
    vi.mocked(getOfficeSupport).mockResolvedValueOnce(null);
    await expect(ThreadPage({ params: Promise.resolve({ threadId: id }), searchParams: Promise.resolve({}) })).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });
  it("renders retryable failures and never logs database exception text containing personal data", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      vi.mocked(listOfficeSupport).mockRejectedValueOnce(new Error("private-customer@example.test"));
      const inbox = await InboxPage({ searchParams: Promise.resolve({}) }); expect(inbox.props.data).toBeNull();
      vi.mocked(getOfficeSupport).mockRejectedValueOnce(new Error("private-message-canary"));
      const thread = await ThreadPage({ params: Promise.resolve({ threadId: id }), searchParams: Promise.resolve({}) }); expect(thread.props.data).toBeNull();
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/private-customer|private-message/);
    } finally { log.mockRestore(); }
  });
});
