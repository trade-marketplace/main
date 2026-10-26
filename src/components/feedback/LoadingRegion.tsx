"use client";
// The M15 "skeleton → content" swap with screen-reader support (#79). While `loading`, it shows the skeleton
// (which only appears after 300ms, so fast loads show nothing), marks the area aria-busy and says the label
// politely once, also after 300ms. When loading ends, the real content cross-fades in (150ms, .tm-anim-swap).
//
//   <LoadingRegion loading={isLoading} label="Loading your jobs" skeleton={<JobRowSkeleton count={3} />}>
//     <JobList jobs={jobs} />
//   </LoadingRegion>
import { type ReactNode, useState } from "react";

import { MOTION_MS } from "@/lib/motion/timings";

import { LiveMessage } from "./LiveMessage";
import styles from "./feedback.module.css";

export type LoadingRegionProps = {
  loading: boolean;
  /** What is loading, for screen readers: "Loading your jobs". Said once, politely, if it takes over 300ms. */
  label: string;
  /** Shapes matching the real layout: <JobRowSkeleton>, <TileSkeleton>, <Skeleton>… */
  skeleton: ReactNode;
  children?: ReactNode;
  className?: string;
};

export function LoadingRegion({ loading, label, skeleton, children, className }: LoadingRegionProps) {
  // Cross-fade only content that replaces a skeleton, not content that was there from the first paint.
  const [wasLoading, setWasLoading] = useState(loading);
  if (loading && !wasLoading) setWasLoading(true);

  // The announcement sits outside the aria-busy area: screen readers hold back changes inside a busy area.
  return (
    <>
      <div className={[styles.region, className].filter(Boolean).join(" ")} aria-busy={loading || undefined}>
        {loading ? skeleton : <div className={wasLoading ? "tm-anim-swap" : undefined}>{children}</div>}
      </div>
      <LiveMessage message={loading ? label : null} delay={MOTION_MS.m15Delay} />
    </>
  );
}
