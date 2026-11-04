import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Viewer } from "@/server/auth/viewer";

vi.mock("@/server/auth/viewer", () => ({ getViewer: vi.fn() }));
vi.mock("@/server/db", () => ({ getDb: vi.fn() }));
vi.mock("@/server/jobs/post-job", () => ({ postJob: vi.fn() }));

import { getViewer } from "@/server/auth/viewer";
import { getDb } from "@/server/db";
import { postJobAction } from "@/server/jobs/actions";
import { inspectPostKeyAction } from "@/server/jobs/posting-actions";
import { postJob } from "@/server/jobs/post-job";

const customerA = randomUUID();
const customerB: Viewer = { userId: randomUUID(), email: "customer-b@example.test", firstName: "B", role: "CUSTOMER", emailVerified: true };
const key = randomUUID();
const reviewedWithoutPhotos = { postKey: key, description: "Customer A's private job", category: "OTHER", photoPaths: [] };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getViewer).mockResolvedValue(customerB);
  vi.mocked(getDb).mockImplementation(() => { throw new Error("Unauthorized requests must not reach the database"); });
});

describe("wizard posting account binding", () => {
  it("returns the shared expiry sentinel when a confirmed owned Review loses its session", async () => {
    vi.mocked(getViewer).mockResolvedValueOnce(null);
    expect(await postJobAction(reviewedWithoutPhotos, key, customerA, { postKey: key, paths: [] })).toEqual({ ok: false, error: "session-expired", values: {} });
    expect(getDb).not.toHaveBeenCalled(); expect(postJob).not.toHaveBeenCalled();
  });

  it.each([customerA, undefined, null, "", 17, {}, [customerB.userId]])("refuses a stale, absent or malformed expected owner: %j", async expectedOwner => {
    expect(await postJobAction(reviewedWithoutPhotos, key, expectedOwner as string | undefined, { postKey: key, paths: [] })).toEqual({ status: "forbidden" });
    expect(getDb).not.toHaveBeenCalled(); expect(postJob).not.toHaveBeenCalled();
  });

  it.each([undefined, { absent: true }, { postKey: randomUUID(), paths: [] }, { postKey: key, paths: "not-a-list" }])("refuses an unconfirmed checkpoint: %j", async version => {
    expect(await postJobAction(reviewedWithoutPhotos, key, customerB.userId, version as Parameters<typeof postJobAction>[3])).toEqual({ status: "photos-pending" });
    expect(getDb).not.toHaveBeenCalled(); expect(postJob).not.toHaveBeenCalled();
  });

  it("binds the confirmed canonical checkpoint to the current viewer and preserves the service's refusal", async () => {
    const db = {} as ReturnType<typeof getDb>;
    vi.mocked(getDb).mockReturnValue(db);
    vi.mocked(postJob).mockResolvedValue({ status: "draft-changed" });
    expect(await postJobAction(reviewedWithoutPhotos, key, customerB.userId, { postKey: key, paths: [] })).toEqual({ status: "draft-changed" });
    expect(postJob).toHaveBeenCalledWith(db, customerB, reviewedWithoutPhotos, key, { expectedDraft: { postKey: key, paths: [] } });
  });
});

describe("consumed post key inspection", () => {
  it("uses the shared session and role guard before inspecting or restarting a draft", async () => {
    vi.mocked(getViewer).mockResolvedValueOnce(null);
    expect(await inspectPostKeyAction(customerB.userId, key)).toMatchObject({ ok: false, error: "session-expired" });
    vi.mocked(getViewer).mockResolvedValueOnce({ ...customerB, role: "TRADIE" });
    expect(await inspectPostKeyAction(customerB.userId, key)).toEqual({ ok: false, error: "forbidden" });
    expect(getDb).not.toHaveBeenCalled();
  });

  it("returns the same opaque result for an account change or malformed key/flags without reading data", async () => {
    expect(await inspectPostKeyAction(customerA, key)).toEqual({ status: "unknown" });
    expect(await inspectPostKeyAction(customerB.userId, "invalid-key")).toEqual({ status: "unknown" });
    expect(await inspectPostKeyAction(customerB.userId, key, "true" as unknown as boolean)).toEqual({ status: "unknown" });
    expect(await inspectPostKeyAction(customerB.userId, key, false, "true" as unknown as boolean)).toEqual({ status: "unknown" });
    expect(getDb).not.toHaveBeenCalled();
  });
});
