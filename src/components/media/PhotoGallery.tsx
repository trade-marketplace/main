"use client";
// A row of job photos that open the viewer (#81): the job page gallery. Each thumbnail is a button
// ("Open photo 2 of 4: Switchboard"); the first is the cover, bigger on a computer.
import { useState } from "react";

import { PhotoViewer, type ViewerPhoto } from "./PhotoViewer";
import styles from "./media.module.css";

export function PhotoGallery({ photos, label = "Photos", className }: { photos: readonly ViewerPhoto[]; label?: string; className?: string }) {
  const [open, setOpen] = useState<number | null>(null);
  if (photos.length === 0) return null;
  return (
    <>
      <ul className={[styles.gallery, className].filter(Boolean).join(" ")} aria-label={label}>
        {photos.map((photo, index) => (
          <li key={photo.src} className={styles.galleryItem}>
            <button type="button" className={styles.galleryButton} onClick={() => setOpen(index)} aria-haspopup="dialog">
              {/* eslint-disable-next-line @next/next/no-img-element -- job photos come from storage */}
              <img src={photo.src} alt="" className={`tm-zoom__img ${styles.galleryImg}`} loading="lazy" decoding="async" />
              <span className={styles.visuallyHidden}>
                {`Open photo ${index + 1} of ${photos.length}: ${photo.alt}`}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <PhotoViewer photos={photos} index={open} onIndexChange={setOpen} onClose={() => setOpen(null)} label={label} />
    </>
  );
}
