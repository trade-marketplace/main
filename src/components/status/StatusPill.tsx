"use client";
// A job's status pill: one server status, worded and coloured for whoever is looking (src/lib/job-status.ts).
// M25: when the status changes on screen, the old pill cross-fades out and the new one pulses in (useSwap +
// .tm-swap). The first render never animates, so a refresh doesn't replay it. Reduced motion: instant swap.
// Renders nothing when that audience doesn't see the status (e.g. a tradie and a PRICED job).
import { useSwap } from "@/lib/motion/hooks";
import { type Audience, type JobStatus, type PillKind, type StatusContext, statusPill } from "@/lib/job-status";

import { Pill } from "./Pill";
import styles from "./status.module.css";

export type StatusPillProps = {
  status: JobStatus;
  audience: Audience;
  context?: StatusContext;
  /**
   * Announce changes to screen readers (role="status"). Use it on the one pill at the top of a job page, not in
   * lists, where every row speaking up would be noise.
   */
  announce?: boolean;
  truncate?: boolean;
  className?: string;
};

const SEP = "\u0000";

export function StatusPill({ status, audience, context, announce = false, truncate, className }: StatusPillProps) {
  const entry = statusPill(status, audience, context);
  const { current, previous, swapKey } = useSwap(entry ? `${entry.kind}${SEP}${entry.label}` : "");
  const show = (key: string, extra: { className?: string; hidden?: boolean }) => {
    const [kind, label] = key.split(SEP) as [PillKind, string];
    return (
      <Pill kind={kind} truncate={truncate} className={extra.className} aria-hidden={extra.hidden}>
        {label}
      </Pill>
    );
  };

  if (!current && !previous) return announce ? <span role="status" /> : null;

  return (
    <span
      className={["tm-swap", styles.swap, className].filter(Boolean).join(" ")}
      role={announce ? "status" : undefined}
      data-status={status}
    >
      {previous ? <span className="tm-anim-status-out">{show(previous, { hidden: true })}</span> : null}
      {current ? (
        <span key={swapKey} className={swapKey > 0 ? "tm-anim-status" : undefined}>
          {show(current, {})}
        </span>
      ) : null}
    </span>
  );
}
