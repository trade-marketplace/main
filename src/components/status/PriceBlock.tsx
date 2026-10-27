"use client";
// The Forest price block (components.css `.tm-pricebox`) in its two versions:
// - customer: their fixed price, incl. GST (C08 "Job · price ready");
// - tradie: what they earn (D06 "Earn"), never the customer's price.
// The props are a union on `audience`: each side only has a field for its own number, and the other side's is
// typed `never`, so TypeScript refuses `<PriceBlock audience="tradie" priceCents={…}>` (and a spread object that
// carries it). At run time each version reads only its own fields, so a smuggled number is never shown either.
// tests/unit/price-block.test.tsx proves both. The numbers are whole cents from the server; nothing is worked out here.
//
// M09 price reveal: pass `revealId` (one per event, e.g. `price-ready:${job.id}`). The first time that event is
// seen the block wipes in, the number counts up from $0, the underline draws and the ticks appear one by one.
// Never on a refresh or revisit, never in the server HTML; reduced motion shows it straight away.
import type { ReactNode } from "react";

import { BoltMark } from "@/components/BoltMark";
import { Icon } from "@/components/Icon";
import { CountUp, formatNzd } from "@/components/motion/CountUp";
import { staggerStyle } from "@/lib/motion/helpers";
import { useCelebration } from "@/lib/motion/hooks";
import { MOTION_MS } from "@/lib/motion/timings";

import styles from "./status.module.css";

type Shared = {
  /** Reassurance lines under the block ("Fixed: it won’t go up"). */
  ticks?: readonly string[];
  /** Play the M09 reveal once for this event. Leave out to show the block as it is. */
  revealId?: string | null;
  className?: string;
};

export type CustomerPriceBlockProps = Shared & {
  audience: "customer";
  /** The customer's fixed total incl. GST, in cents (jobs.price_cents). */
  priceCents: number;
  earnCents?: never;
  breakdown?: never;
};

/** How the tradie's pay is made up, shown as "4 hrs × $64.80 + holiday pay". Their own figures only. */
export type EarnBreakdown = {
  minutes: number;
  /** Their hourly rate, in cents. */
  rateCents: number;
  holidayPay?: boolean;
};

export type TradiePriceBlockProps = Shared & {
  audience: "tradie";
  /** What the tradie earns for the job, in cents. */
  earnCents: number;
  breakdown?: EarnBreakdown;
  priceCents?: never;
};

export type PriceBlockProps = CustomerPriceBlockProps | TradiePriceBlockProps;

/** $259.20 from 25920. */
export function formatCents(cents: number): string {
  return formatNzd(cents / 100);
}

/** "4 hrs × $64.80 + holiday pay". */
export function formatBreakdown({ minutes, rateCents, holidayPay }: EarnBreakdown): string {
  const hours = Math.round((minutes / 60) * 100) / 100;
  const time = `${hours.toLocaleString("en-NZ")} ${hours === 1 ? "hr" : "hrs"}`;
  return `${time} × ${formatCents(rateCents)}${holidayPay ? " + holiday pay" : ""}`;
}

export function PriceBlock(props: PriceBlockProps) {
  // Read only the fields that belong to this side, whatever else was passed.
  if (props.audience === "tradie") {
    const { earnCents, breakdown, ticks, revealId, className } = props;
    return (
      <Block
        caption="Earn"
        cents={earnCents}
        side={breakdown ? <span className={styles.breakdown}>{formatBreakdown(breakdown)}</span> : null}
        ticks={ticks}
        revealId={revealId}
        className={className}
        audience="tradie"
      />
    );
  }
  const { priceCents, ticks, revealId, className } = props;
  return (
    <Block
      caption="Your price"
      cents={priceCents}
      note="Fixed price · incl. GST"
      underline
      ticks={ticks}
      revealId={revealId}
      className={className}
      audience="customer"
    />
  );
}

type BlockProps = Shared & {
  audience: "customer" | "tradie";
  caption: string;
  cents: number;
  note?: string;
  side?: ReactNode;
  underline?: boolean;
};

function Block({ audience, caption, cents, note, side, underline, ticks, revealId, className }: BlockProps) {
  const play = useCelebration(revealId);
  const anim = (cls: string) => (play ? cls : undefined);
  const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

  return (
    <div className={className} data-audience={audience}>
      <div className={cx(styles.pricebox, anim("tm-anim-wipe"))}>
        <BoltMark variant="hero" className={styles.priceBolt} />
        <div className={styles.priceRow}>
          <div className={styles.priceMain}>
            <span className={styles.priceCap}>{caption}</span>
            <CountUp
              value={cents / 100}
              format={formatNzd}
              run={play}
              runKey={revealId ?? ""}
              duration={MOTION_MS.m09Count}
              delay={MOTION_MS.m09Wipe}
              className={styles.price}
            />
            {note ? <span className={styles.priceCap}>{note}</span> : null}
          </div>
          {side}
        </div>
        {underline ? <span className={cx(styles.underline, anim("tm-anim-underline"))} aria-hidden="true" /> : null}
      </div>
      {ticks?.length ? (
        <ul className={styles.ticks}>
          {ticks.map((tick, i) => (
            <li key={tick} className={anim("tm-anim-tick")} style={play ? staggerStyle(i) : undefined}>
              <Icon name="check_circle" fill decorative size="sm" className={styles.tickIcon} />
              <span>{tick}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
