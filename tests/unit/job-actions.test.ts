import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

vi.mock("@/server/auth/viewer", () => ({ getViewer: vi.fn(async () => null) }));
vi.mock("@/server/db", () => ({ getDb: vi.fn(() => { throw new Error("Should not access data without a session"); }) }));

import { getDb } from "@/server/db";
import { draftPhotoUrlAction, loadDraftAction, postJobAction, saveDraftAction } from "@/server/jobs/actions";

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
    expect(await draftPhotoUrlAction(randomUUID(), "photo.webp")).toMatchObject({ ok: false, error: "session-expired" });
    expect(getDb).not.toHaveBeenCalled();
  });
});
