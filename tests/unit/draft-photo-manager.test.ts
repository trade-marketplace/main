import { afterEach, describe, expect, it, vi } from "vitest";
import { DraftPhotoManager, type PhotoManagerDeps } from "@/lib/jobs/draft-photo-manager";
import { photoDraftKey, prepareDraftPhoto, resizedDimensions, type StoredDraftPhoto } from "@/lib/jobs/draft-photo-browser";

const instances: DraftPhotoManager[] = [];
afterEach(() => { instances.forEach(manager => manager.dispose()); instances.length = 0; vi.useRealTimers(); });
const file = (name = "photo.jpg") => new File([new Uint8Array([255, 216, 255, 1])], name, { type: "image/jpeg" });
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason?: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function fixture(overrides: Partial<PhotoManagerDeps> = {}, ownerId: string | null = null, serverPaths: string[] = []) {
  const deps: PhotoManagerDeps = { read: vi.fn(async () => null), write: vi.fn(async () => {}), prepare: vi.fn(async input => input), online: () => true,
    createUrl: vi.fn(input => `blob:${input.name}:${Math.random()}`), revokeUrl: vi.fn(), ...overrides };
  const manager = new DraftPhotoManager({ ownerId, postKey: "draft-one" }, deps); instances.push(manager); await manager.start(serverPaths); return { manager, deps };
}
const done = (manager: DraftPhotoManager) => vi.waitFor(() => { expect(manager.getSnapshot().photos.every(photo => photo.status !== "uploading")).toBe(true); expect(manager.getSnapshot().saving).toBe(false); });

describe("browser preparation and identity", () => {
  it("shrinks the longest edge to 2000px without enlarging or distorting", () => {
    expect(resizedDimensions(4000, 3000)).toEqual({ width: 2000, height: 1500 });
    expect(resizedDimensions(1200, 600)).toEqual({ width: 1200, height: 600 });
    expect(resizedDimensions(1000, 4000)).toEqual({ width: 500, height: 2000 });
  });
  it("passes HEIC bytes untouched to the server conversion path", async () => {
    const source = new File(["heic bytes"], "IMG_1001.HEIC", { type: "image/heic" });
    expect(await prepareDraftPhoto(source)).toBe(source);
  });
  it("separates guest and account storage, and separates drafts of the same account", () => {
    expect(photoDraftKey({ ownerId: null, postKey: "one" })).not.toBe(photoDraftKey({ ownerId: "a", postKey: "one" }));
    expect(photoDraftKey({ ownerId: "a", postKey: "one" })).not.toBe(photoDraftKey({ ownerId: "b", postKey: "one" }));
    expect(photoDraftKey({ ownerId: "a", postKey: "one" })).not.toBe(photoDraftKey({ ownerId: "a", postKey: "two" }));
  });
});

describe("draft photo lifecycle", () => {
  it("shows local thumbnails immediately and keeps guest blobs without any network upload", async () => {
    const { manager, deps } = await fixture(); const source = file(); manager.add([source]);
    expect(manager.getSnapshot().photos[0]).toMatchObject({ src: expect.stringContaining("blob:"), status: "uploading", file: source });
    await done(manager); await manager.flush();
    expect(manager.getSnapshot().photos[0].status).toBe("done"); expect(manager.paths()).toEqual([]);
    expect(deps.write).toHaveBeenLastCalledWith(manager.scope, [expect.objectContaining({ file: source, prepared: true })]);
  });
  it("queues a file selected during restore and merges it after the stored photos without losing either", async () => {
    const read = deferred<null | { id: string; name: string; file: File; prepared: boolean }[]>();
    const manager = new DraftPhotoManager({ ownerId: null, postKey: "restoring" }, {
      read: async () => read.promise, write: vi.fn(async () => {}), prepare: async input => input, online: () => true, createUrl: input => `blob:${input.name}`, revokeUrl: vi.fn(),
    }); instances.push(manager);
    const starting = manager.start([]); manager.add([file("new.jpg")]);
    read.resolve([{ id: "restored", name: "saved.jpg", file: file("saved.jpg"), prepared: true }]);
    await starting; await done(manager); await manager.flush();
    expect(manager.getSnapshot().photos.map(photo => photo.name)).toEqual(["saved.jpg", "new.jpg"]);
  });
  it("keeps other files when one is too big, wrong type or beyond the six-photo limit", async () => {
    const { manager } = await fixture();
    const huge = new File(["x"], "large.jpg", { type: "image/jpeg" }); Object.defineProperty(huge, "size", { value: 11 * 1024 * 1024 });
    manager.add([huge, new File(["x"], "notes.pdf", { type: "application/pdf" }), ...Array.from({ length: 7 }, (_, index) => file(`${index}.jpg`))]);
    expect(manager.getSnapshot().photos).toHaveLength(6); expect(manager.getSnapshot().problems).toHaveLength(3);
    await done(manager); expect(manager.getSnapshot().photos.every(photo => photo.status === "done")).toBe(true);
  });
  it("serializes the latest cover/order even when uploads finish out of order and a save is slow", async () => {
    const uploads = new Map<string, ReturnType<typeof deferred<string>>>(); const firstSave = deferred<void>(); const saved: string[][] = [];
    const { manager } = await fixture({ upload: async input => { const task = deferred<string>(); uploads.set(input.name, task); return task.promise; },
      saveServer: async paths => { saved.push([...paths]); if (saved.length === 1) await firstSave.promise; } }, "owner");
    manager.add([file("a.jpg"), file("b.jpg")]);
    await vi.waitFor(() => expect(uploads.size).toBe(2));
    uploads.get("a.jpg")!.resolve("path-a"); await vi.waitFor(() => expect(saved).toHaveLength(1));
    const b = manager.getSnapshot().photos[1]; manager.move(b.id, 0); uploads.get("b.jpg")!.resolve("path-b");
    firstSave.resolve(); await done(manager); await manager.flush();
    expect(manager.paths()).toEqual(["path-b", "path-a"]); expect(saved.at(-1)).toEqual(["path-b", "path-a"]);
  });
  it("never reinserts a removed photo when its aborted upload finishes late", async () => {
    const upload = deferred<string>(); const { manager } = await fixture({ upload: async () => upload.promise, saveServer: vi.fn(async () => {}) }, "owner");
    manager.add([file()]); await vi.waitFor(() => expect(manager.getSnapshot().photos[0].prepared).toBe(true));
    const id = manager.getSnapshot().photos[0].id; manager.remove(id); upload.resolve("late-path"); await manager.flush();
    await new Promise(resolve => setTimeout(resolve, 0)); expect(manager.getSnapshot().photos).toEqual([]); expect(manager.paths()).toEqual([]);
  });
  it("Undo restores the original position and retains the original thumbnail during its window", async () => {
    const { manager, deps } = await fixture(); manager.add([file("a.jpg"), file("b.jpg"), file("c.jpg")]); await done(manager);
    const original = manager.getSnapshot().photos[1]; manager.remove(original.id);
    expect(deps.revokeUrl).not.toHaveBeenCalledWith(original.src); manager.undo(); await manager.flush();
    expect(manager.getSnapshot().photos.map(photo => photo.name)).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
    expect(manager.getSnapshot().photos[1].src).toBe(original.src);
  });
  it("keeps Undo available when its visible toast has been paused beyond 4.5 seconds", async () => {
    const { manager, deps } = await fixture(); manager.add([file()]); await done(manager);
    const original = manager.getSnapshot().photos[0]; vi.useFakeTimers(); manager.remove(original.id);
    await vi.advanceTimersByTimeAsync(12_000); expect(deps.revokeUrl).not.toHaveBeenCalledWith(original.src);
    manager.undo(); await manager.flush(); expect(manager.getSnapshot().photos[0].id).toBe(original.id);
  });
  it("Undo cannot create a seventh photo after a replacement was added", async () => {
    const { manager } = await fixture(); manager.add(Array.from({ length: 6 }, (_, index) => file(`${index}.jpg`))); await done(manager);
    manager.remove(manager.getSnapshot().photos[0].id); manager.add([file("replacement.jpg")]); await done(manager); manager.undo();
    expect(manager.getSnapshot().photos).toHaveLength(6); expect(manager.getSnapshot().problems[0]).toContain("up to 6");
  });
  it("quota failures retain the File for Retry and never claim that persistence succeeded", async () => {
    let blocked = true; const { manager } = await fixture({ write: async () => { if (blocked) throw new Error("Quota exceeded"); } });
    const source = file(); manager.add([source]); await done(manager);
    expect(manager.getSnapshot()).toMatchObject({ storageError: true }); expect(manager.getSnapshot().photos[0]).toMatchObject({ file: source, status: "failed" });
    await expect(manager.flush()).rejects.toThrow(); blocked = false; manager.retry(manager.getSnapshot().photos[0].id); await done(manager); await manager.flush();
    expect(manager.getSnapshot().storageError).toBe(false); expect(manager.getSnapshot().photos[0].status).toBe("done");
  });
  it("a new device restores private server photos without uploading a second copy", async () => {
    const upload = vi.fn(); const preview = vi.fn(async path => `https://private.test/${path}`);
    const { manager } = await fixture({ upload, preview, saveServer: vi.fn(async () => {}) }, "owner");
    await manager.start(["path-a", "path-b"]); await done(manager);
    expect(manager.paths()).toEqual(["path-a", "path-b"]); expect(manager.getSnapshot().photos[0].src).toBe("https://private.test/path-a"); expect(upload).not.toHaveBeenCalled();
  });
  it("uses server additions/order/removals while preserving genuinely unuploaded same-draft files", async () => {
    const pending = file("unsynced.jpg"); const upload = vi.fn<NonNullable<PhotoManagerDeps["upload"]>>().mockResolvedValue("new-upload"); const saved = vi.fn<NonNullable<PhotoManagerDeps["saveServer"]>>().mockResolvedValue(undefined);
    const { manager } = await fixture({ read: async () => [
      { id: "removed", name: "removed.jpg", path: "removed-path", file: file("removed.jpg"), prepared: true },
      { id: "retained", name: "retained.jpg", path: "retained-path", file: file("retained.jpg"), prepared: true },
      { id: "unsynced", name: pending.name, file: pending, prepared: true },
    ], upload, preview: async path => `https://private.test/${path}`, saveServer: saved }, "owner", ["new-server-path", "retained-path"]);
    await done(manager); await manager.flush();
    expect(manager.paths()).toEqual(["new-server-path", "retained-path", "new-upload"]);
    expect(manager.getSnapshot().photos.map(photo => photo.name)).toEqual(["Photo 1", "retained.jpg", "unsynced.jpg"]);
    expect(upload).toHaveBeenCalledTimes(1); expect(upload.mock.calls[0][0]).toBe(pending);
    expect(saved).toHaveBeenLastCalledWith(["new-server-path", "retained-path", "new-upload"], expect.any(Array));
  });
  it("retains six saved plus six unsynced files across exit/restore, blocking uploads until conflict removal", async () => {
    const paths = Array.from({ length: 6 }, (_, index) => `server-${index}`);
    const pending = Array.from({ length: 6 }, (_, index) => file(`pending-${index}.jpg`));
    let stored: readonly StoredDraftPhoto[] = pending.map((file, index) => ({ id: `pending-${index}`, name: file.name, file, prepared: true }));
    const upload = vi.fn(async (file: File) => `uploaded-${file.name}`);
    const deps: Partial<PhotoManagerDeps> = { read: async () => [...stored], write: async (_scope, photos) => { stored = [...photos]; }, upload,
      preview: async path => `https://private.test/${path}`, saveServer: vi.fn(async () => {}) };
    const first = await fixture(deps, "owner", paths); await done(first.manager); await first.manager.prepareExit();
    expect(first.manager.paths()).toEqual(paths); expect(stored).toHaveLength(12); expect(stored.flatMap(photo => photo.file ? [photo.file] : [])).toEqual(pending);
    expect(upload).not.toHaveBeenCalled(); first.manager.dispose();
    const restored = await fixture(deps, "owner", paths); await done(restored.manager);
    expect(restored.manager.getSnapshot().photos).toHaveLength(12); expect(restored.manager.getSnapshot().problems).toEqual(["You can add up to 6 photos, so 6 weren’t added."]);
    restored.manager.retry("pending-0"); expect(upload).not.toHaveBeenCalled();
    for (const photo of restored.manager.getSnapshot().photos.filter(photo => photo.path)) restored.manager.remove(photo.id);
    for (const photo of restored.manager.getSnapshot().photos) restored.manager.retry(photo.id);
    await done(restored.manager); await restored.manager.flush(); expect(upload).toHaveBeenCalledTimes(6);
    expect(restored.manager.paths()).toEqual(pending.map(file => `uploaded-${file.name}`));
  });
  it("reconciles fresh same-key server props and a save CAS conflict without losing an active file or its order", async () => {
    const upload = deferred<string>(); const firstSave = deferred<void>(); const saving = deferred<void>(); let hold = true;
    let server = ["a"];
    const { manager } = await fixture({ upload: async () => upload.promise, preview: async path => `https://private.test/${path}`,
      saveServer: async (paths, expected) => {
        if (hold) { hold = false; saving.resolve(); await firstSave.promise; }
        if (JSON.stringify(expected) !== JSON.stringify(server)) return { status: "photos-changed", photoPaths: [...server] };
        server = [...paths]; return { status: "saved" };
      } }, "owner", server);
    await done(manager); manager.add([file("active.jpg")]); await vi.waitFor(() => expect(manager.getSnapshot().photos[1].prepared).toBe(true));
    const active = manager.getSnapshot().photos[1]; server = ["b", "a"]; manager.reconcile(server); await saving.promise;
    server = ["c", "b"]; firstSave.resolve();
    await vi.waitFor(() => expect(manager.paths()).toEqual(["c", "b"]));
    expect(manager.getSnapshot().photos.find(photo => photo.id === active.id)?.file).toBe(active.file);
    manager.move(active.id, 0); upload.resolve("uploaded-active"); await done(manager); await manager.flush();
    expect(server).toEqual(["uploaded-active", "c", "b"]); expect(manager.paths()).toEqual(server);
  });
  it("an ambiguously acknowledged path removed remotely never auto-reattaches, while its bytes remain retryable", async () => {
    let stored: readonly StoredDraftPhoto[] = []; let fail = true; let count = 0;
    const upload = vi.fn(async () => `upload-${++count}`);
    const overrides: Partial<PhotoManagerDeps> = { read: async () => [...stored], write: async (_scope, photos) => { stored = [...photos]; }, upload,
      preview: async path => `https://private.test/${path}`, saveServer: async () => { if (fail) throw new Error("Response lost after commit"); } };
    const { manager } = await fixture(overrides, "owner"); manager.add([file("uncertain.jpg")]); await done(manager);
    expect(manager.getSnapshot().photos[0]).toMatchObject({ path: "upload-1", pendingAttach: true, status: "failed" });
    fail = false; manager.reconcile(["remote-current"]); await done(manager); await manager.flush();
    expect(manager.paths()).toEqual(["remote-current"]); expect(upload).toHaveBeenCalledTimes(1);
    expect(manager.getSnapshot().photos[1]).toMatchObject({ name: "uncertain.jpg", path: undefined, needsRetry: true, status: "failed" });
    await manager.prepareExit(); manager.dispose();
    const restored = await fixture(overrides, "owner", ["remote-current"]); await done(restored.manager);
    expect(restored.manager.paths()).toEqual(["remote-current"]); expect(upload).toHaveBeenCalledTimes(1);
    restored.manager.retry(restored.manager.getSnapshot().photos[1].id); await done(restored.manager); await restored.manager.flush();
    expect(restored.manager.paths()).toEqual(["remote-current", "upload-2"]);
  });
  it("disposal aborts owner A work and revokes its thumbnails without populating owner B", async () => {
    const upload = deferred<string>(); const { manager: a, deps } = await fixture({ upload: async () => upload.promise }, "a"); a.add([file()]);
    await vi.waitFor(() => expect(a.getSnapshot().photos[0].prepared).toBe(true)); const url = a.getSnapshot().photos[0].src; a.dispose();
    const { manager: b } = await fixture({}, "b"); upload.resolve("a-private-path"); await new Promise(resolve => setTimeout(resolve, 0));
    expect(b.getSnapshot().photos).toEqual([]); expect(deps.revokeUrl).toHaveBeenCalledWith(url);
  });
  it("no-photo posting and offline exit remain possible when there are no blobs to persist", async () => {
    const { manager } = await fixture({ read: async () => { throw new Error("Storage unavailable"); }, write: async () => { throw new Error("Storage unavailable"); }, online: () => false });
    await expect(manager.prepareExit()).resolves.toBeUndefined(); expect(manager.getSnapshot().photos).toEqual([]);
  });
});
