"use client";
// /dev/components/status demos that need a click: M25 status change, M11 tracker progress and M09 price reveal.
// They use the real components, so what plays here is what the app plays. The buttons are plain <button>s
// styled for this page: the kit's buttons come with #74.
import { useState } from "react";

import { Icon } from "@/components/Icon";
import { PriceBlock } from "@/components/status/PriceBlock";
import { StatusPill } from "@/components/status/StatusPill";
import { Tracker } from "@/components/status/Tracker";
import { type Audience, JOB_STATUSES, statusPill } from "@/lib/job-status";
import { usePrefersReducedMotion } from "@/lib/motion/hooks";

import styles from "./status-preview.module.css";

export function ReducedMotionNote() {
  const reduced = usePrefersReducedMotion();
  return (
    <p className={styles.reduced} data-reduced={reduced ? "on" : "off"}>
      Reduced motion: <b>{reduced ? "on, every animation is an instant change" : "off"}</b>
    </p>
  );
}

/** M25: steps through the statuses this audience sees. */
export function StatusChangeDemo({ audience }: { audience: Audience }) {
  const shown = JOB_STATUSES.filter((s) => statusPill(s, audience));
  const [index, setIndex] = useState(0);
  const status = shown[index % shown.length];
  return (
    <div className={styles.demo}>
      <div className={styles.stage}>
        <StatusPill status={status} audience={audience} announce />
        <code className={styles.caption}>{status}</code>
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.button} onClick={() => setIndex((i) => (i + 1) % shown.length)}>
          <Icon name="arrow_forward" decorative size="sm" />
          Move the job on
        </button>
      </div>
    </div>
  );
}

const JOURNEY = [
  { label: "Posted" },
  { label: "Getting your price", note: "We’ll let you know when it’s ready." },
  { label: "Accept & pay" },
  { label: "Tradie on the way" },
  { label: "Sorted" },
];

/** M11: moves the customer journey on a step at a time. */
export function TrackerProgressDemo() {
  const [current, setCurrent] = useState(1);
  const done = current >= JOURNEY.length;
  return (
    <div className={styles.demo}>
      <div className={styles.stage}>
        <Tracker steps={JOURNEY} current={current} label="Tracker progress demo" />
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.button} onClick={() => setCurrent((c) => c + 1)} disabled={done}>
          <Icon name="arrow_downward" decorative size="sm" />
          Next step
        </button>
        <button type="button" className={styles.buttonSecondary} onClick={() => setCurrent(1)}>
          Start again
        </button>
      </div>
    </div>
  );
}

/** M09: each press is a new event, so it plays; "Revisit" is the same event again, so it doesn't. */
export function PriceRevealDemo({ ticks }: { ticks: readonly string[] }) {
  const [eventId, setEventId] = useState<string | null>(null);
  const [visit, setVisit] = useState(0);
  return (
    <div className={styles.demo}>
      <div className={styles.prices}>
        <div>
          <h3 className={styles.subTitle}>Customer: price ready</h3>
          <PriceBlock
            key={`c-${eventId}-${visit}`}
            audience="customer"
            priceCents={37200}
            ticks={ticks}
            revealId={eventId && `${eventId}:customer`}
          />
        </div>
        <div>
          <h3 className={styles.subTitle}>Tradie: earnings</h3>
          <PriceBlock
            key={`t-${eventId}-${visit}`}
            audience="tradie"
            earnCents={25920}
            breakdown={{ minutes: 240, rateCents: 6480, holidayPay: true }}
            revealId={eventId && `${eventId}:tradie`}
          />
        </div>
      </div>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.button}
          onClick={() => {
            setVisit(0);
            setEventId(`demo-price-ready:${Date.now()}`);
          }}
        >
          <Icon name="play_arrow" fill decorative size="sm" />
          Play the price reveal
        </button>
        <button type="button" className={styles.buttonSecondary} onClick={() => setVisit((v) => v + 1)} disabled={!eventId}>
          Revisit the same job
        </button>
      </div>
    </div>
  );
}
