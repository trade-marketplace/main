"use client";
// Spinners and progress bars (#79). For small waits inside a page ("Loading more jobs" under a list) and for
// uploads. Never a full-page spinner: a page that is loading shows skeletons (FRONTEND_SPEC "Loading"). A button
// that is working uses its own spinner: <Button loading>.
//
//   <Spinner label="Loading more jobs" />                   ring + words, read out politely
//   <Spinner label="Checking the address" hideLabel />      ring only; the words are for screen readers
//   <ProgressBar label="Uploading kitchen.jpg" value={0.4} />   40%
//   <ProgressBar label="Sending your photos" />             no value: the bar slides until it's done
import { LiveMessage } from "./LiveMessage";
import styles from "./feedback.module.css";

export type SpinnerProps = {
  /** What is happening, in words: "Loading more jobs". */
  label: string;
  /** Show only the ring. The label is still read out. */
  hideLabel?: boolean;
  /** sm 16px (inside text), md 20px, lg 32px. */
  size?: "sm" | "md" | "lg";
  className?: string;
};

export function Spinner({ label, hideLabel = false, size = "md", className }: SpinnerProps) {
  const ring = [styles.ring, size === "sm" && styles.ringSm, size === "lg" && styles.ringLg].filter(Boolean).join(" ");
  // The label is said once, politely (LiveMessage), and stays in the page for anyone reading it. Under reduced
  // motion the ring stands still and the words still say it's working.
  return (
    <span className={[styles.spinner, className].filter(Boolean).join(" ")}>
      <span aria-hidden="true" className={ring} />
      <span className={hideLabel ? styles.visuallyHidden : styles.spinnerLabel}>{label}</span>
      <LiveMessage message={label} />
    </span>
  );
}

export type ProgressBarProps = {
  /** What is in progress: "Uploading kitchen.jpg". Shown above the bar and used as its accessible name. */
  label: string;
  /** 0 to 1. Leave it out when you can't tell how far along it is. */
  value?: number;
  className?: string;
};

/** Clamps to 0–100 and rounds, for the bar and for aria-valuenow. */
export function percentOf(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.min(1, Math.max(0, value)) * 100);
}

export function ProgressBar({ label, value, className }: ProgressBarProps) {
  const known = typeof value === "number";
  const percent = known ? percentOf(value) : null;
  const classes = [styles.progress, !known && styles.indeterminate, className].filter(Boolean).join(" ");
  return (
    <div className={classes}>
      <div className={styles.progressHead} aria-hidden="true">
        <span className={styles.progressLabel}>{label}</span>
        {percent !== null && <span className={styles.progressValue}>{percent}%</span>}
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={known ? 0 : undefined}
        aria-valuemax={known ? 100 : undefined}
        aria-valuenow={percent ?? undefined}
        aria-valuetext={percent !== null ? `${percent}%` : "Working on it"}
        className={styles.track}
      >
        <span className={styles.fill} style={percent !== null ? { width: `${percent}%` } : undefined} />
      </div>
    </div>
  );
}
