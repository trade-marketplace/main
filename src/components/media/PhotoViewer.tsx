"use client";
// The photo viewer (lightbox) (#81): WEBAPP_SPEC job page, "click opens full-screen viewer, arrow keys". A modal
// <dialog> over a dark scrim: the photo as large as fits, "2 of 4", previous / next buttons and Close.
// ← and → move, Esc closes, focus stays inside, and goes back to the thumbnail that opened it.
//
//   <PhotoViewer photos={photos} index={open} onIndexChange={setOpen} onClose={() => setOpen(null)} />
import { type KeyboardEvent, useEffect, useRef } from "react";

import { IconButton } from "@/components/Button";

import styles from "./media.module.css";

export type ViewerPhoto = { src: string; alt: string };

export type PhotoViewerProps = {
  photos: readonly ViewerPhoto[];
  /** The photo shown, or null when closed. */
  index: number | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  /** Names the viewer for screen readers: "Photos of Sub wiring". */
  label?: string;
};

export function PhotoViewer({ photos, index, onIndexChange, onClose, label = "Photos" }: PhotoViewerProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  const open = index !== null && photos.length > 0;
  const current = open ? Math.min(Math.max(index, 0), photos.length - 1) : 0;

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) {
      opener.current = document.activeElement;
      el.showModal();
    } else if (!open && el.open) {
      el.close();
      if (opener.current instanceof HTMLElement) opener.current.focus();
    }
  }, [open]);

  const go = (step: number) => onIndexChange((current + step + photos.length) % photos.length);

  function onKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (photos.length < 2) return;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      go(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      go(-1);
    }
  }

  const photo = photos[current];
  return (
    <dialog
      ref={dialog}
      className={styles.viewer}
      aria-label={label}
      onKeyDown={onKeyDown}
      // Esc: the browser closes the dialog; tell the parent instead, so it owns the state.
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // A click on the dark area around the photo closes it.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {open && photo && (
        <div className={styles.viewerInner}>
          <p className={styles.viewerCount} aria-live="polite">
            {current + 1} of {photos.length}
          </p>
          <span className={styles.viewerClose}>
            <IconButton icon="close" label="Close" onClick={onClose} />
          </span>
          {/* eslint-disable-next-line @next/next/no-img-element -- job photos come from storage at full size */}
          <img key={photo.src} src={photo.src} alt={photo.alt} className={`${styles.viewerImg} tm-anim-thumb`} />
          {photos.length > 1 && (
            <>
              <span className={styles.viewerPrev}>
                <IconButton icon="chevron_left" label="Previous photo" onClick={() => go(-1)} />
              </span>
              <span className={styles.viewerNext}>
                <IconButton icon="chevron_right" label="Next photo" onClick={() => go(1)} />
              </span>
            </>
          )}
        </div>
      )}
    </dialog>
  );
}
