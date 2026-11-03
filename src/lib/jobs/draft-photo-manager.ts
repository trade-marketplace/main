import type { PickedPhoto } from "@/components/media/PhotoPicker";
import { checkPhotos, MAX_PHOTOS } from "@/lib/media";
import type { PhotoDraftScope, StoredDraftPhoto } from "./draft-photo-browser";
import { DraftPhotoUploadError } from "./draft-photo-upload";

export type DraftPhoto = PickedPhoto & StoredDraftPhoto & { prepared: boolean; generation: number };
export type PhotoSnapshot = { photos: readonly DraftPhoto[]; problems: readonly string[]; restoring: boolean; saving: boolean; storageError: boolean };
export type PhotoManagerDeps = {
  read: (scope: PhotoDraftScope) => Promise<StoredDraftPhoto[] | null>;
  write: (scope: PhotoDraftScope, photos: readonly StoredDraftPhoto[]) => Promise<void>;
  prepare: (file: File) => Promise<File>;
  upload?: (file: File, signal: AbortSignal, progress: (fraction: number) => void) => Promise<string>;
  preview?: (path: string) => Promise<string>;
  saveServer?: (paths: string[]) => Promise<void>;
  online: () => boolean;
  createUrl: (file: File) => string;
  revokeUrl: (url: string) => void;
};
const failedMessage = "We couldn't save that file. Try again.";

/** One instance per owner + postKey. All persistence is ordered; async completions update only surviving IDs. */
export class DraftPhotoManager {
  private state: PhotoSnapshot = { photos: [], problems: [], restoring: true, saving: false, storageError: false };
  private listeners = new Set<() => void>();
  private urls = new Set<string>();
  private uploads = new Map<string, AbortController>();
  private localWrites: Promise<void> = Promise.resolve();
  private serverWrites: Promise<void> = Promise.resolve();
  private epoch = 0;
  private generation = 0;
  private revision = 0;
  private lastServerOrder = "";
  private localError = false;
  private serverError = false;
  private pendingWrites = 0;
  private disposed = false;
  private undoPhoto: { photo: DraftPhoto; index: number } | null = null;
  private queuedFiles: File[] = [];
  constructor(readonly scope: PhotoDraftScope, private deps: PhotoManagerDeps) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private emit(patch: Partial<PhotoSnapshot>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch }; this.listeners.forEach(listener => listener());
  }
  private objectUrl(file: File) { const url = this.deps.createUrl(file); this.urls.add(url); return url; }
  private release(url: string) { if (this.urls.delete(url)) this.deps.revokeUrl(url); }
  private current(id: string, generation: number) { return this.state.photos.find(photo => photo.id === id && photo.generation === generation); }
  private update(id: string, generation: number, update: Partial<DraftPhoto>) {
    if (this.disposed || !this.current(id, generation)) return false;
    this.emit({ photos: this.state.photos.map(photo => photo.id === id ? { ...photo, ...update } : photo) }); return true;
  }
  // Existing paths remain attached while their viewing link is refreshed; Retry with bytes or Remove replaces them.
  paths() { return this.state.photos.filter(photo => photo.path).map(photo => photo.path!); }
  private storedPhotos(): StoredDraftPhoto[] { return this.state.photos.map(photo => ({ id: photo.id, name: photo.name, file: photo.file, path: photo.path, prepared: photo.prepared })); }

  private persist() {
    const revision = ++this.revision; const snapshot = this.storedPhotos();
    this.pendingWrites++; this.emit({ saving: true });
    const write = this.localWrites.catch(() => {}).then(() => this.deps.write(this.scope, snapshot));
    this.localWrites = write;
    void write.then(() => {
      this.pendingWrites--; if (revision === this.revision) this.localError = false;
      this.emit({ saving: this.pendingWrites > 0, storageError: this.localError || this.serverError });
    }, () => {
      this.pendingWrites--; if (revision === this.revision) this.localError = true;
      this.emit({ saving: this.pendingWrites > 0, storageError: this.localError || this.serverError });
    });
    return write;
  }
  private saveOrder() {
    if (!this.deps.saveServer || !this.deps.online()) return Promise.resolve();
    const key = JSON.stringify(this.paths());
    if (key === this.lastServerOrder) return this.serverWrites;
    this.lastServerOrder = key;
    this.pendingWrites++; this.emit({ saving: true });
    const write = this.serverWrites.catch(() => {}).then(async () => {
      if (this.disposed) return;
      // Read the latest state when our turn arrives, never an upload/reorder callback's stale list.
      const paths = this.paths(); await this.deps.saveServer!(paths);
    });
    this.serverWrites = write;
    void write.then(() => {
      this.pendingWrites--; this.serverError = false;
      this.emit({ saving: this.pendingWrites > 0, storageError: this.localError });
    }, () => {
      this.pendingWrites--; this.serverError = true; this.lastServerOrder = "";
      this.emit({ saving: this.pendingWrites > 0, storageError: true });
    });
    return write;
  }

  async start(serverPaths: readonly string[]) {
    this.disposed = false; const epoch = ++this.epoch;
    this.lastServerOrder = JSON.stringify(serverPaths);
    this.emit({ restoring: true });
    try {
      let local: StoredDraftPhoto[] | null = null;
      try { local = await this.deps.read(this.scope); }
      catch { this.localError = true; }
      if (epoch !== this.epoch || this.disposed) return;
      const records: StoredDraftPhoto[] = local ?? serverPaths.map((path, index) => ({ id: crypto.randomUUID(), name: `Photo ${index + 1}`, path }));
      const photos = records.slice(0, MAX_PHOTOS).map(record => ({ ...record, prepared: record.prepared === true, generation: ++this.generation,
        src: record.file ? this.objectUrl(record.file) : "", status: "uploading" as const, progress: 0 }));
      this.emit({ photos, restoring: false, storageError: this.localError && photos.length > 0 });
      for (const photo of photos) void this.process(photo.id, photo.generation);
      if (!photos.length && local !== null) void this.saveOrder();
      const queued = this.queuedFiles; this.queuedFiles = []; if (queued.length) this.add(queued);
    } catch { if (epoch === this.epoch) this.emit({ restoring: false, storageError: true }); }
  }

  add(files: File[]) {
    if (this.state.restoring) { this.queuedFiles.push(...files); return; }
    const checked = checkPhotos(files, { existing: this.state.photos.length });
    const empty = checked.accepted.filter(file => !file.size);
    const accepted = checked.accepted.filter(file => file.size);
    const photos: DraftPhoto[] = accepted.map(file => ({ id: crypto.randomUUID(), name: file.name, file, src: this.objectUrl(file), prepared: false, status: "uploading", progress: 0, generation: ++this.generation }));
    this.emit({ photos: [...this.state.photos, ...photos], problems: [...checked.problems, ...empty.map(file => `${file.name}: That file is empty. Choose another one.`)] });
    // Start persisting the original files immediately, before image processing or a network request.
    void this.persist().catch(() => {});
    for (const photo of photos) void this.process(photo.id, photo.generation);
  }

  private async process(id: string, generation: number) {
    const initial = this.current(id, generation); if (!initial || this.disposed) return;
    const abort = new AbortController(); this.uploads.set(id, abort);
    try {
      let file = initial.file;
      if (initial.path && this.deps.preview) {
        if (!this.deps.online() && file) { this.update(id, generation, { status: "done", progress: 1 }); return; }
        const src = await this.deps.preview(initial.path);
        if (this.update(id, generation, { src, status: "done", progress: 1 })) { await this.persist(); await this.saveOrder(); }
        return;
      }
      if (!file) throw new Error(failedMessage);
      if (!initial.prepared) {
        file = await this.deps.prepare(file);
        if (!this.update(id, generation, { file, prepared: true, progress: 0.05 })) return;
      }
      await this.persist();
      if (!this.current(id, generation) || abort.signal.aborted) return;
      if (!this.deps.upload) { this.update(id, generation, { status: "done", progress: 1 }); await this.persist(); return; }
      if (!this.deps.online()) throw new Error(failedMessage);
      await this.saveOrder();
      const path = await this.deps.upload(file, abort.signal, progress => this.update(id, generation, { progress }));
      if (!this.update(id, generation, { path, status: "done", progress: 1 })) return;
      await this.persist(); await this.saveOrder();
      if (this.deps.preview) {
        try {
          const src = await this.deps.preview(path); const previous = this.current(id, generation)?.src;
          if (this.update(id, generation, { src }) && previous) this.release(previous);
        } catch { /* The saved photo stays safe; its local preview or HEIC filename remains available. */ }
      }
    } catch (error) {
      if (!abort.signal.aborted && this.update(id, generation, { status: "failed" })) {
        this.emit({ problems: [error instanceof DraftPhotoUploadError ? error.message : this.current(id, generation)?.prepared ? failedMessage : "We couldn't read that picture. Try another one."] });
        void this.saveOrder().catch(() => {});
      }
    } finally { if (this.uploads.get(id) === abort) this.uploads.delete(id); }
  }

  retry(id: string) {
    const photo = this.state.photos.find(item => item.id === id); if (!photo) return;
    this.uploads.get(id)?.abort(); const generation = ++this.generation;
    this.emit({ photos: this.state.photos.map(item => item.id === id ? { ...item, path: item.file ? undefined : item.path, generation, status: "uploading", progress: 0 } : item), problems: [] });
    void this.process(id, generation);
  }
  move(id: string, position: number) {
    const photos = [...this.state.photos]; const index = photos.findIndex(photo => photo.id === id);
    if (index < 0 || position < 0 || position >= photos.length || index === position) return;
    const [photo] = photos.splice(index, 1); photos.splice(position, 0, photo);
    this.emit({ photos }); void this.persist().catch(() => {}); void this.saveOrder().catch(() => {});
  }
  remove(id: string): boolean {
    const index = this.state.photos.findIndex(photo => photo.id === id); if (index < 0) return false;
    if (this.undoPhoto) this.release(this.undoPhoto.photo.src);
    const photo = this.state.photos[index]; this.uploads.get(id)?.abort();
    // One removed photo is bounded in memory until Undo, the next removal, or disposal. The shared toast may
    // remain visible longer than four seconds while hovered/focused, so a separate wall-clock expiry is unsafe.
    this.undoPhoto = { photo, index };
    this.emit({ photos: this.state.photos.filter(item => item.id !== id), problems: [] });
    void this.persist().catch(() => {}); void this.saveOrder().catch(() => {}); return true;
  }
  undo() {
    const removed = this.undoPhoto; if (!removed) return;
    if (this.state.photos.length >= MAX_PHOTOS) { this.emit({ problems: ["You can add up to 6 photos, so 1 wasn’t added."] }); return; }
    this.undoPhoto = null;
    const photo = { ...removed.photo, generation: ++this.generation };
    const photos = [...this.state.photos]; photos.splice(Math.min(removed.index, photos.length), 0, photo);
    this.emit({ photos }); void this.persist().catch(() => {}); void this.saveOrder().catch(() => {});
    if (photo.status !== "done") { this.update(photo.id, photo.generation, { status: "uploading", progress: 0 }); void this.process(photo.id, photo.generation); }
  }
  async retryPersistence() { await this.persist(); await this.saveOrder(); }
  async flush() {
    await this.localWrites.catch(error => { if (this.state.photos.length) throw error; });
    if (this.deps.online()) await this.serverWrites;
    else { this.serverError = false; this.emit({ storageError: this.localError }); }
    if (this.state.storageError && this.state.photos.length) throw new Error(failedMessage);
    if (!this.state.photos.length) { this.localError = false; this.emit({ storageError: false }); }
  }
  async waitForRestore() {
    if (!this.state.restoring) return;
    await new Promise<void>(resolve => { const stop = this.subscribe(() => { if (!this.state.restoring) { stop(); resolve(); } }); });
  }
  async prepareExit() {
    for (const [id, abort] of this.uploads) { abort.abort(); const photo = this.state.photos.find(item => item.id === id); if (photo) this.update(id, photo.generation, { status: "failed" }); }
    await this.persist().catch(error => { if (this.state.photos.length) throw error; });
    await this.saveOrder(); await this.flush();
  }
  dispose() {
    this.disposed = true; this.epoch++; this.uploads.forEach(abort => abort.abort()); this.uploads.clear();
    this.undoPhoto = null; this.queuedFiles = [];
    this.urls.forEach(url => this.deps.revokeUrl(url)); this.urls.clear();
  }
}
