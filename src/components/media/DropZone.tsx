"use client";
// The drop zone (#81, M26): pages.html w-c-post2. A dashed box: drag photos onto it (the border turns solid action
// colour and the tint fills) or "choose files". The file input is a real button for keyboards and screen readers.
//
//   <DropZone onFiles={add} hint="JPG, PNG, HEIC up to 10 MB" />
import { type ReactNode, useId, useRef } from "react";

import { Icon } from "@/components/Icon";
import { useDropZone } from "@/lib/motion/hooks";
import { PHOTO_ACCEPT } from "@/lib/media";

import styles from "./media.module.css";

export type DropZoneProps = {
  onFiles: (files: File[]) => void;
  /** The line under "choose files": what it takes. */
  hint?: ReactNode;
  title?: string;
  /** Default: photos (PHOTO_ACCEPT). */
  accept?: string;
  multiple?: boolean;
  /** Can't take more (e.g. 6 photos already): greyed, and this says why. */
  disabled?: string;
  className?: string;
};

export function DropZone({ onFiles, hint, title = "Drop photos here", accept = PHOTO_ACCEPT, multiple = true, disabled, className }: DropZoneProps) {
  const input = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const drop = useDropZone((files) => !disabled && onFiles([...files]));
  return (
    <div
      className={["tm-dropzone", styles.dropzone, className].filter(Boolean).join(" ")}
      data-disabled={disabled ? true : undefined}
      {...(disabled ? {} : drop.props)}
    >
      <Icon name="cloud_upload" decorative className={styles.dropIcon} />
      {title && <p className={styles.dropTitle}>{title}</p>}
      <p className={styles.dropHint}>
        <button
          type="button"
          className={styles.chooseFiles}
          onClick={() => input.current?.click()}
          aria-describedby={hint || disabled ? hintId : undefined}
          disabled={Boolean(disabled)}
        >
          Choose files
        </button>
        {hint && <span id={disabled ? undefined : hintId}> · {hint}</span>}
      </p>
      {disabled && (
        <p className={styles.dropHint} id={hintId}>
          {disabled}
        </p>
      )}
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple={multiple}
        hidden
        tabIndex={-1}
        onChange={(event) => {
          const files = event.currentTarget.files;
          if (files?.length) onFiles([...files]);
          event.currentTarget.value = "";
        }}
      />
    </div>
  );
}
