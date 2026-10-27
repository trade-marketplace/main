"use client";
// The photo picker (#81): screens.html cus-post-2 and pages.html w-c-post2. A grid of square thumbnails (5px corners,
// 6px gaps). Each one uploads straight away (M18): a progress ring over it, × to remove, and a failed one gets a red
// outline with Retry. An "Add photo" tile opens the camera or photo library on a phone. Under it, "2 of 6 · JPG, PNG
// or HEIC up to 10 MB each". Problems with picked files (too big, not a photo, too many) show under the grid.
//
// It holds no files itself: the page owns the list (and the uploading), and gets onAdd / onRemove / onRetry.
//   <PhotoPicker photos={photos} onAdd={upload} onRemove={remove} onRetry={retry} problems={problems} />
import { useId, useRef } from "react";

import { Icon } from "@/components/Icon";
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
};

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
}: PhotoPickerProps) {
  const input = useRef<HTMLInputElement>(null);
  const countId = useId();
  const problemsId = useId();
  const full = photos.length >= max;
  return (
    <div className={[styles.picker, className].filter(Boolean).join(" ")}>
      <ul className={styles.grid} aria-label={label} aria-describedby={countId}>
        {photos.map((photo, index) => (
          <li key={photo.id} className={`${styles.tile} tm-anim-thumb`} data-status={photo.status}>
            {/* eslint-disable-next-line @next/next/no-img-element -- local previews (object URLs) */}
            <img src={photo.src} alt={`Photo ${index + 1}: ${photo.name}`} className={styles.tileImg} />
            {photo.status === "uploading" && (
              <span className={styles.tileCover}>
                <ProgressRing status="uploading" progress={photo.progress} label={photo.name} />
              </span>
            )}
            {photo.status === "failed" && (
              <span className={styles.failed}>
                <span>Failed ·</span>
                <button type="button" className={styles.retry} onClick={() => onRetry(photo.id)}>
                  Retry<span className={styles.visuallyHidden}> {photo.name}</span>
                </button>
              </span>
            )}
            {/* A 44px target around the mockup's 26px dark circle. */}
            <button type="button" className={styles.remove} aria-label={`Remove ${photo.name}`} onClick={() => onRemove(photo.id)}>
              <span className={styles.removeDot}>
                <Icon name="close" size="sm" decorative />
              </span>
            </button>
          </li>
        ))}
        {addTile && !full && (
          <li className={styles.tile}>
            <button type="button" className={styles.addTile} onClick={() => input.current?.click()} aria-describedby={countId}>
              <Icon name="photo_camera" decorative className={styles.addIcon} />
              Add photo
            </button>
          </li>
        )}
      </ul>
      <p id={countId} className={styles.count}>
        {photoCountLine(photos.length, max)}
      </p>
      {problems.length > 0 && (
        <ul id={problemsId} className={styles.problems} role="alert">
          {problems.map((problem) => (
            <li key={problem}>
              <Icon name="error" size="sm" decorative />
              {problem}
            </li>
          ))}
        </ul>
      )}
      <input
        ref={input}
        type="file"
        accept={PHOTO_ACCEPT}
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
