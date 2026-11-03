import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

vi.mock("@/server/auth/viewer", () => ({ getViewer: vi.fn(async () => null) }));
vi.mock("@/server/db", () => ({ getDb: vi.fn(() => { throw new Error("Should not access data without a session"); }) }));

import { getDb } from "@/server/db";
import { getViewer } from "@/server/auth/viewer";
import { draftPhotoUrlAction, loadDraftAction, loadDraftPhotosAction, postJobAction, saveDraftAction, saveDraftPhotosAction } from "@/server/jobs/actions";

describe("job actions before sign-in", () => {
  it("returns the sign-up gate without touching a database or losing browser-local input", async () => {
    const input = { description: "Move a sofa upstairs" };
    expect(await postJobAction(input, randomUUID())).toEqual({ status: "needs-account" });
    expect(input).toEqual({ description: "Move a sofa upstairs" });
    expect(getDb).not.toHaveBeenCalled();
  });
  it("guards stored drafts and their private photo previews with the shared role guard", async () => {
    expect(await saveDraftAction({})).toMatchObject({ ok: false, error: "session-expired" });
    expect(await loadDraftAction()).toMatchObject({ ok: false, error: "session-expired" });
    expect(await loadDraftPhotosAction("owner", randomUUID())).toMatchObject({ ok: false, error: "session-expired" });
    expect(await saveDraftPhotosAction("owner", randomUUID(), [], [])).toMatchObject({ ok: false, error: "session-expired" });
    expect(await draftPhotoUrlAction(randomUUID(), "photo.webp")).toMatchObject({ ok: false, error: "session-expired" });
    expect(getDb).not.toHaveBeenCalled();
  });
  it("refuses a stale wizard after logging in with another customer account", async () => {
    vi.mocked(getViewer).mockResolvedValueOnce({ userId: "customer-b", email: "b@example.test", firstName: "B", role: "CUSTOMER", emailVerified: true });
    expect(await saveDraftAction({ description: "Customer A's private job" }, "customer-a")).toEqual({ status: "forbidden" });
    expect(getDb).not.toHaveBeenCalled();
  });
  it("does not read or change photo references after the session switches to another customer", async () => {
    const other = { userId: "customer-b", email: "b@example.test", firstName: "B", role: "CUSTOMER" as const, emailVerified: true };
    vi.mocked(getViewer).mockResolvedValueOnce(other);
    expect(await loadDraftPhotosAction("customer-a", randomUUID())).toEqual({ status: "forbidden" });
    vi.mocked(getViewer).mockResolvedValueOnce(other);
    expect(await saveDraftPhotosAction("customer-a", randomUUID(), [], [])).toEqual({ status: "forbidden" });
    expect(getDb).not.toHaveBeenCalled();
  });
  it("refuses an authenticated full or photo save without a confirmed version, including after a failed load", async () => {
    const viewer = { userId: "customer-a", email: "a@example.test", firstName: "A", role: "CUSTOMER" as const, emailVerified: true };
    vi.mocked(getViewer).mockResolvedValueOnce(viewer);
    await expect(loadDraftPhotosAction("customer-a", randomUUID())).rejects.toThrow("Should not access data");
    const reads = vi.mocked(getDb).mock.calls.length;
    vi.mocked(getViewer).mockResolvedValueOnce(viewer);
    expect(await saveDraftAction({ description: "Unconfirmed local text" }, "customer-a")).toEqual({ status: "unconfirmed" });
    vi.mocked(getViewer).mockResolvedValueOnce(viewer);
    expect(await saveDraftPhotosAction("customer-a", randomUUID(), [], undefined as unknown as string[])).toEqual({ status: "unconfirmed" });
    expect(getDb).toHaveBeenCalledTimes(reads);
  });
});
