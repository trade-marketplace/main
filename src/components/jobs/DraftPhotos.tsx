"use client";
import { Button } from "@/components/Button";
import { Skeleton } from "@/components/feedback/Skeleton";
import { DropZone } from "@/components/media/DropZone";
import { PhotoPicker } from "@/components/media/PhotoPicker";
import { Banner } from "@/components/overlays/Banner";
import { useToast } from "@/components/overlays/Toast";
import type { PhotoSnapshot } from "@/lib/jobs/draft-photo-manager";
import type { JobType } from "@/lib/post-job-wizard";
import styles from "./post-job.module.css";

export type DraftPhotosControls = {
  add(files: File[]): void; retry(id: string): void; remove(id: string): boolean; undo(): void; move(id: string, position: number): void; retryPersistence(): Promise<void>;
};
export function DraftPhotos({ state, controls, category, offline, busy, onNext, backHref, dragOver = false }: {
  state: PhotoSnapshot; controls: DraftPhotosControls; category?: JobType; offline: boolean; busy: boolean; onNext(): void; backHref: string; dragOver?: boolean;
}) {
  const toast = useToast();
  const uploading = state.photos.filter(photo => photo.status === "uploading").length;
  const blocked = offline || state.restoring || state.saving || state.photos.some(photo => photo.status !== "done") || state.storageError && state.photos.length > 0;
  return <div className={styles.photoForm} onDragOver={event => { if (Array.from(event.dataTransfer.types).includes("Files")) event.preventDefault(); }} onDrop={event => {
    if (!event.defaultPrevented && event.dataTransfer.files.length) { event.preventDefault(); if (!state.restoring) controls.add([...event.dataTransfer.files]); }
  }}>
    <p className={styles.photoIntro}><span className={styles.photoPhoneIntro}>Show us the problem. </span>Wide shot + close-up works best.<span className={styles.photoDesktopIntro}> 1 to 6 photos.</span></p>
    <div className={styles.photoDrop} data-preview-over={dragOver || undefined}>
      <DropZone onFiles={files => controls.add(files)} accept="image/*" hint="JPG, PNG, HEIC up to 10 MB" disabled={state.restoring ? "Loading photos" : state.photos.length >= 6 ? "6 of 6" : busy ? "Uploading…" : undefined} />
    </div>
    {state.restoring ? <div className={styles.photoSkeleton} role="status" aria-label="Loading photos"><Skeleton height={100} /><Skeleton height={100} /><Skeleton height={100} /></div> :
      <PhotoPicker photos={state.photos} onAdd={files => controls.add(files)} onRetry={id => controls.retry(id)} problems={state.problems} onReorder={(id, position) => controls.move(id, position)} cover accept="image/*" addLabel="Add photos"
        onRemove={id => { if (controls.remove(id)) toast.show({ message: "Photo removed.", icon: "delete", action: { label: "Undo", onAction: () => controls.undo() } }); }} />}
    {state.storageError && <Banner tone="alert" title="Couldn’t save." action={<Button variant="tertiary" onClick={() => void controls.retryPersistence().catch(() => {})}>Try again</Button>} live />}
    {!state.restoring && !state.photos.length && <p className={styles.hint}>Photos get you a price faster</p>}
    {category === "ELECTRICAL" && <Banner tone="brand" icon="lightbulb">Turn the power off before getting close to anything electrical.</Banner>}
    <div className={`${styles.actions} ${styles.photoActions}`}>
      <Button href={backHref} variant="tertiary" width="auto">Back</Button>
      <Button onClick={onNext} disabled={blocked} loading={busy} width="full-on-phone">{uploading ? `Uploading ${uploading}…` : "Next"}</Button>
    </div>
  </div>;
}
