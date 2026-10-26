// Skeletons (#79): grey shapes the size of the content that is on its way. The look, the 300ms wait before they
// show and the 1.2s shimmer are M15 (.tm-skel in src/styles/motion.css); under reduced motion they are static
// grey. Skeletons are decorative (aria-hidden): wrap them in <LoadingRegion>, which tells screen readers what is
// loading. Match the real layout, never a full-page spinner (FRONTEND_SPEC "Loading").
//
//   <Skeleton width={200} height={26} />                    one block
//   <SkeletonText lines={3} />                              a paragraph
//   <JobRowSkeleton count={3} />                            rows like My jobs and the job board (.tm-jobrow)
//   <TileSkeleton count={3} />                              category tiles (.tm-cat)
import type { CSSProperties } from "react";

import styles from "./feedback.module.css";

type Size = number | string;
const px = (size: Size | undefined) => (typeof size === "number" ? `${size}px` : size);

export type SkeletonProps = {
  /** A number is pixels; a string is any CSS length ("40%", "12rem"). Default: the full width. */
  width?: Size;
  /** Default 14px, one line of text. */
  height?: Size;
  /** line: 6px corners (text, blocks) · circle: avatars · pill: status pills and chips. */
  shape?: "line" | "circle" | "pill";
  className?: string;
  style?: CSSProperties;
};

export function Skeleton({ width, height, shape = "line", className, style }: SkeletonProps) {
  const classes = [
    "tm-skel",
    styles.skel,
    height === undefined && styles.skelLine,
    shape === "circle" && styles.skelCircle,
    shape === "pill" && styles.skelPill,
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return <span aria-hidden="true" className={classes} style={{ width: px(width), height: px(height), ...style }} />;
}

/** Lines of text. The last line is shorter, as the end of a paragraph is. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <span aria-hidden="true" className={[styles.skelText, className].filter(Boolean).join(" ")}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={i === lines - 1 && lines > 1 ? "60%" : "100%"} />
      ))}
    </span>
  );
}

/** Rows shaped like .tm-jobrow (64px photo; category, title and status pill), as on My jobs and the board. */
export function JobRowSkeleton({ count = 3 }: { count?: number }) {
  return (
    <ul aria-hidden="true" className={styles.skelList}>
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className={styles.skelRow}>
          <Skeleton width={64} height={64} />
          <span className={styles.skelRowBody}>
            <Skeleton width="40%" height={10} />
            <Skeleton width="70%" height={14} />
            <Skeleton width="30%" height={18} shape="pill" />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Tiles shaped like .tm-cat (a 110 × 96 picture and a name), as on the customer home. */
export function TileSkeleton({ count = 3 }: { count?: number }) {
  return (
    <ul aria-hidden="true" className={styles.skelTiles}>
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className={styles.skelTile}>
          <Skeleton width={110} height={96} />
          <Skeleton width={80} height={14} />
        </li>
      ))}
    </ul>
  );
}
