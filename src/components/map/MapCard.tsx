"use client";
// The map card (#82): the job a pin or row was picked for, over the map (D03 desktop, D18 phone). Bounties get the
// gold outline, the M27 glint and a countdown ring. The ring's number ticks but is never a live region: screen
// readers get "3 h left" as the ring's name, which changes at most once an hour, and only when they reach it.
import type { CSSProperties, ReactNode } from "react";

import { Icon } from "@/components/Icon";
import {
  formatCents,
  formatTimeLeftSpoken,
  isExpired,
  jobCaption,
  KIND_NAMES,
  type MapJob,
} from "@/lib/map/pins";
import { formatCountdown, isUrgent, ringFraction } from "@/lib/motion/helpers";

import { useBountyRemaining } from "./MapPin";
import styles from "./map.module.css";

const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(" ");

/** M27 countdown ring: fills with gold for the time left; under 2h it pulses gently (.tm-ring-urgent). */
export function CountdownRing({ remainingMs, totalMs }: { remainingMs: number; totalMs: number }) {
  const expired = isExpired(remainingMs);
  const percent = Math.round(ringFraction(remainingMs, totalMs) * 100);
  return (
    <span
      className={cx(styles.ring, isUrgent(remainingMs) && "tm-ring-urgent")}
      style={{ "--p": percent } as CSSProperties}
      role="img"
      aria-label={formatTimeLeftSpoken(remainingMs)}
      data-urgent={isUrgent(remainingMs) ? "true" : undefined}
    >
      <span className={styles.ringInner} aria-hidden="true">
        {expired ? <Icon name="timer_off" decorative className={styles.ringIcon} /> : formatCountdown(remainingMs)}
      </span>
    </span>
  );
}

const STATUS: Record<MapJob["kind"], { className: string; icon?: string; fill?: boolean; label: string }> = {
  claim: { className: styles.statusClaim, label: KIND_NAMES.claim },
  estimate: { className: "", icon: "photo_camera", label: KIND_NAMES.estimate },
  visit: { className: styles.statusVisit, icon: "directions_walk", label: KIND_NAMES.visit },
  bounty: { className: styles.statusBounty, icon: "paid", fill: true, label: "Quote bounty" },
};

const THUMB_ICON: Record<MapJob["kind"], string> = {
  claim: "handyman",
  estimate: "photo_camera",
  visit: "directions_walk",
  bounty: "paid",
};

type MapCardProps = {
  job: MapJob;
  serverNow: number;
  id?: string;
  /** The card's heading level, so it fits the page's outline. */
  headingLevel?: 2 | 3 | 4;
  /** Shows a close control. */
  onClose?: () => void;
  /** Where the job's page is: the title becomes the link to it. */
  href?: string;
  /** The card's action (e.g. "Claim bounty" from the button kit, #74). */
  action?: ReactNode;
};

export function MapCard({ job, serverNow, id, headingLevel = 3, onClose, href, action }: MapCardProps) {
  const remaining = useBountyRemaining(job, serverNow);
  const expired = job.kind === "bounty" && remaining !== null && isExpired(remaining);
  const status = STATUS[job.kind];
  const Heading = `h${headingLevel}` as const;
  const titleId = id ? `${id}-title` : undefined;

  return (
    <article
      id={id}
      aria-labelledby={titleId}
      className={cx(styles.card, job.kind === "bounty" && styles.cardBounty, job.kind === "bounty" && !expired && "tm-glint")}
      data-card-kind={job.kind}
    >
      <div className={styles.cardTop}>
        <span className={cx(styles.thumb, job.kind === "bounty" && styles.thumbBounty)} aria-hidden="true">
          <Icon name={THUMB_ICON[job.kind]} fill={job.kind === "bounty"} decorative />
        </span>
        <div className={styles.cardBody}>
          <span className={cx(styles.status, expired ? "" : status.className)}>
            {status.icon && <Icon name={status.icon} fill={status.fill} decorative className={styles.statusIcon} />}
            {expired ? "Bounty expired" : status.label}
          </span>
          <Heading id={titleId} className={styles.cardTitle}>
            {href ? <a href={href}>{job.title}</a> : job.title}
          </Heading>
          <p className={styles.caption}>{jobCaption(job)}</p>
          {job.precision === "approximate" && (
            <p className={cx(styles.caption, styles.approx)}>
              <Icon name="blur_circular" decorative className={styles.approxIcon} />
              Approximate area
            </p>
          )}
        </div>
        {job.kind === "bounty" && remaining !== null && (
          <CountdownRing remainingMs={remaining} totalMs={job.durationMs} />
        )}
        {onClose && (
          <button type="button" className={styles.close} onClick={onClose} aria-label={`Close ${job.title}`}>
            <Icon name="close" decorative size="sm" />
          </button>
        )}
      </div>
      <div className={styles.cardFoot}>
        <div>
          <p className={styles.caption}>{footLabel(job, expired)}</p>
          {(job.kind === "claim" || job.kind === "bounty") && (
            <b className={styles.amount}>{formatCents(job.kind === "claim" ? job.earnCents : job.bountyCents)}</b>
          )}
        </div>
        {!expired && action}
      </div>
    </article>
  );
}

function footLabel(job: MapJob, expired: boolean): string {
  switch (job.kind) {
    case "claim":
      return "Earn";
    case "estimate":
      return "Private estimate.";
    case "visit":
      return "Site visit.";
    case "bounty":
      return expired ? "Expired." : "Earn";
  }
}
