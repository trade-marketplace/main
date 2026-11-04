"use client";
// The photo picker (#81): screens.html cus-post-2 and pages.html w-c-post2. A grid of square thumbnails (5px corners,
// 6px gaps). Each one uploads straight away (M18): a progress ring over it, × to remove, and a failed one gets a red
// outline with Retry. An "Add photo" tile opens the camera or photo library on a phone. Under it, "2 of 6 · JPG, PNG
// or HEIC up to 10 MB each". Problems with picked files (too big, not a photo, too many) show under the grid.
//
// It holds no files itself: the page owns the list (and the uploading), and gets onAdd / onRemove / onRetry.
//   <PhotoPicker photos={photos} onAdd={upload} onRemove={remove} onRetry={retry} problems={problems} />
import { useEffect, useId, useRef, useState } from "react";

import { Icon } from "@/components/Icon";
import { Menu, MenuItem } from "@/components/overlays/Menu";
import { MAX_PHOTOS, PHOTO_ACCEPT, photoCountLine } from "@/lib/media";

import { ProgressRing, type UploadStatus } from "./ProgressRing";
import styles from "./media.module.css";

export type PickedPhoto = {
  id: string;
  /** A preview URL: an object URL while uploading, the stored photo's URL after. */
  src: string;
  /** The file name, for screen readers and the remove button ("Remove kitchen.jpg"). */
  name: string;
  status: UploadStatus;
  /** 0 to 1 while uploading, if known. */
  progress?: number;
};

export type PhotoPickerProps = {
  photos: readonly PickedPhoto[];
  onAdd: (files: File[]) => void;
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
  /** Why some picked files weren't added (checkPhotos()). */
  problems?: readonly string[];
  max?: number;
  /** Show the dashed "Add photo" tile in the grid (the phone layout). With a <DropZone> above, leave it off. */
  addTile?: boolean;
  /** The group's name for screen readers. */
  label?: string;
  className?: string;
  /** The listing wizard's cover/order controls; existing read-only pickers keep their current layout. */
  onReorder?: (id: string, position: number) => void;
  cover?: boolean;
  addLabel?: string;
  accept?: string;
  /** A restore conflict can show saved photos plus failed local files without calling the excess accepted. */
  acceptedCount?: number;
  retryDisabled?: boolean;
};

export function PhotoThumbnail({ photo, index }: { photo: Pick<PickedPhoto, "src" | "name">; index: number }) {
  const [broken, setBroken] = useState(false); const [source, setSource] = useState(photo.src);
  if (source !== photo.src) { setSource(photo.src); setBroken(false); }
  const label = `Photo ${index + 1}: ${photo.name}`;
  // Some browsers cannot decode HEIC previews; retain the real file and show its name until server conversion.
  return broken || !photo.src ? <span role="img" aria-label={label} className={styles.photoFallback}><Icon name="image" decorative /><span>{photo.name}</span></span>
    : <img src={photo.src} alt={label} className={styles.tileImg} draggable={false} onError={() => setBroken(true)} />; // eslint-disable-line @next/next/no-img-element -- immediate local object URL
}

/** How long the done tick stays after an upload finishes (M18: "a tick pops when done"). */
export const DONE_TICK_MS = 1200;

/** The ring while uploading; when it finishes, the tick pops and stays a moment, then the photo is clear. */
function UploadOverlay({ photo }: { photo: PickedPhoto }) {
  const [justDone, setJustDone] = useState(false);
  const [previous, setPrevious] = useState(photo.status);
  if (previous !== photo.status) {
    setPrevious(photo.status);
    setJustDone(previous === "uploading" && photo.status === "done");
  }
  useEffect(() => {
    if (!justDone) return;
    const timer = window.setTimeout(() => setJustDone(false), DONE_TICK_MS);
    return () => window.clearTimeout(timer);
  }, [justDone]);
  if (photo.status !== "uploading" && !justDone) return null;
  return (
    <span className={styles.tileCover}>
      <ProgressRing status={photo.status === "uploading" ? "uploading" : "done"} progress={photo.progress} label={photo.name} />
    </span>
  );
}

export function PhotoPicker({
  photos,
  onAdd,
  onRemove,
  onRetry,
  problems = [],
  max = MAX_PHOTOS,
  addTile = true,
  label = "Photos",
  className,
  onReorder,
  cover = false,
  addLabel = "Add photo",
  accept = PHOTO_ACCEPT,
  acceptedCount,
  retryDisabled = false,
}: PhotoPickerProps) {
  const input = useRef<HTMLInputElement>(null);
  const countId = useId();
  const problemsId = useId();
  const full = photos.length >= max;
  return (
    <div className={[styles.picker, className].filter(Boolean).join(" ")} data-empty={photos.length === 0}>
      <ul className={styles.grid} aria-label={label} aria-describedby={countId}>
        {photos.map((photo, index) => (
          <li key={photo.id} className={`${styles.tile} tm-anim-thumb`} data-status={photo.status} data-reorder={Boolean(onReorder)} data-photo-id={photo.id}
            draggable={Boolean(onReorder)} onDragStart={event => { if (onReorder) { event.dataTransfer.setData("application/x-trade-photo", photo.id); event.dataTransfer.effectAllowed = "move"; } }}
            onDragOver={event => { if (onReorder && Array.from(event.dataTransfer.types).includes("application/x-trade-photo")) event.preventDefault(); }}
            onDrop={event => { const id = event.dataTransfer.getData("application/x-trade-photo"); if (id && onReorder) { event.preventDefault(); onReorder(id, index); } }}>
            <PhotoThumbnail photo={photo} index={index} />
            <UploadOverlay photo={photo} />
            {cover && index === 0 && <span className={styles.coverBadge}>Cover</span>}
            {onReorder && <Menu className={styles.photoMenu} align="start" label={`Photo options ${photo.name}`} trigger={props => <button {...props} type="button" className={styles.photoOptions} aria-label={`Photo options ${photo.name}`}><span className={styles.removeDot}><Icon name="more_horiz" size="sm" decorative /></span></button>}>
              <MenuItem icon="photo" disabled={index === 0} onSelect={() => onReorder(photo.id, 0)}>Make cover</MenuItem>
              <MenuItem icon="arrow_back" disabled={index === 0} onSelect={() => onReorder(photo.id, index - 1)}>Move left</MenuItem>
              <MenuItem icon="arrow_forward" disabled={index === photos.length - 1} onSelect={() => onReorder(photo.id, index + 1)}>Move right</MenuItem>
            </Menu>}
            {photo.status === "failed" && (
              <span className={styles.failed}>
                <span>Failed ·</span>
                <button type="button" className={styles.retry} disabled={retryDisabled} aria-describedby={retryDisabled && problems.length ? problemsId : undefined} onClick={() => onRetry(photo.id)}>
                  Retry<span className={styles.visuallyHidden}> {photo.name}</span>
                </button>
              </span>
            )}
            {/* A 44px target around the mockup's 26px dark circle. */}
            <button type="button" className={styles.remove} aria-label={`Remove ${photo.name}`} onClick={event => {
              const picker = event.currentTarget.closest(`.${styles.picker}`); const wasFocused = document.activeElement === event.currentTarget;
              onRemove(photo.id);
              if (wasFocused) requestAnimationFrame(() => (picker?.querySelectorAll<HTMLButtonElement>(`button.${styles.remove}`)[Math.min(index, photos.length - 2)] ?? picker?.querySelector<HTMLButtonElement>(`button.${styles.addTile}`))?.focus());
            }}>
              <span className={styles.removeDot}>
                <Icon name="close" size="sm" decorative />
              </span>
            </button>
          </li>
        ))}
        {addTile && !full && (
          <li className={styles.tile} data-photo-add>
            <button type="button" className={styles.addTile} onClick={() => input.current?.click()} aria-describedby={countId}>
              <Icon name="photo_camera" decorative className={styles.addIcon} />
              {addLabel}
            </button>
          </li>
        )}
      </ul>
      <p id={countId} className={styles.count}>
        {photoCountLine(acceptedCount ?? photos.length, max)}
      </p>
      {problems.length > 0 && (
        <div role="alert"><ul id={problemsId} className={styles.problems}>
          {problems.map((problem) => (
            <li key={problem}>
              <Icon name="error" size="sm" decorative />
              {problem}
            </li>
          ))}
        </ul></div>
      )}
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple
        hidden
        tabIndex={-1}
        onChange={(event) => {
          const files = event.currentTarget.files;
          if (files?.length) onAdd([...files]);
          event.currentTarget.value = "";
        }}
      />
    </div>
  );
}
