// The upload progress ring (#81, M18): fills with the real upload, a tick pops when it's done, a red ring with an
// error mark when it failed. It's a progressbar for screen readers ("Uploading kitchen.jpg, 40%").
import { Icon } from "@/components/Icon";

import styles from "./media.module.css";

export type UploadStatus = "uploading" | "done" | "failed";

export type ProgressRingProps = {
  status: UploadStatus;
  /** 0 to 1, while uploading. Leave it out when the size isn't known yet: the ring spins. */
  progress?: number;
  /** What's uploading, for screen readers: "kitchen.jpg". */
  label: string;
  size?: number;
  className?: string;
};

const R = 16;
const C = 2 * Math.PI * R;

export function ProgressRing({ status, progress, label, size = 40, className }: ProgressRingProps) {
  const known = typeof progress === "number" && Number.isFinite(progress);
  const fraction = known ? Math.min(1, Math.max(0, progress)) : 0.25;
  const classes = [styles.ring, className].filter(Boolean).join(" ");
  if (status !== "uploading") {
    return (
      <span className={classes} data-status={status} style={{ width: size, height: size }} role="img"
        aria-label={status === "done" ? `${label} uploaded` : `${label} didn’t upload`}>
        <Icon name={status === "done" ? "check" : "priority_high"} size="sm" decorative className={status === "done" ? "tm-anim-tick-pop" : undefined} />
      </span>
    );
  }
  return (
    <span
      className={classes}
      data-status="uploading"
      data-indeterminate={known ? undefined : true}
      style={{ width: size, height: size }}
      role="progressbar"
      aria-label={`Uploading ${label}`}
      aria-valuemin={known ? 0 : undefined}
      aria-valuemax={known ? 100 : undefined}
      aria-valuenow={known ? Math.round(fraction * 100) : undefined}
    >
      <svg viewBox="0 0 40 40" aria-hidden="true" focusable="false">
        <circle className={styles.ringTrack} cx="20" cy="20" r={R} />
        <circle className={styles.ringFill} cx="20" cy="20" r={R} strokeDasharray={C} strokeDashoffset={C * (1 - fraction)} />
      </svg>
    </span>
  );
}
