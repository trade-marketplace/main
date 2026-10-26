"use client";
// M10 Bolt flash: the brand's one celebration, for big wins only (Posted, Paid, It's yours, Sorted, Estimate
// sent). The signature circle pops (spring), the tick or bolt draws in, 8 sparks burst out 26px and fade, and a
// soft signature glow pulses behind: 600ms. Plays once per event (`eventId`, e.g. `posted:${job.id}`), never on
// a refresh or a revisit, never under reduced motion; otherwise it just shows the circle and its mark.
// Purely decorative (the page's heading says what happened), so hidden from screen readers.
import type { CSSProperties } from "react";

import { BoltMark } from "@/components/BoltMark";
import { Icon } from "@/components/Icon";
import { useCelebration } from "@/lib/motion/hooks";

/** The 8 sparks, 45deg apart, as drawn in the mockups. */
export const SPARK_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315] as const;

type BoltFlashProps = {
  /** What happened. A new id plays the flash once; the same id again shows it still. Null never plays. */
  eventId: string | null;
  /** Tick for customers' wins (Posted, Paid, Sorted); bolt for tradies' (It's yours). */
  mark?: "check" | "bolt";
  /** Circle diameter in px (mockups: 110 on success pages, 120 on landing). */
  size?: number;
  className?: string;
};

export function BoltFlash({ eventId, mark = "check", size, className }: BoltFlashProps) {
  const play = useCelebration(eventId);
  const classes = ["tm-flash", play && "is-playing", className].filter(Boolean).join(" ");
  const style = size ? ({ "--tm-flash-size": `${size}px` } as CSSProperties) : undefined;

  return (
    <div className={classes} style={style} aria-hidden="true" data-playing={play ? "true" : "false"}>
      <div className="tm-flash__glow" />
      <div className="tm-flash__sparks">
        {SPARK_ANGLES.map((angle) => (
          <i key={angle} style={{ "--a": `${angle}deg` } as CSSProperties} />
        ))}
      </div>
      <div className="tm-flash__circle">
        <span className="tm-flash__mark">
          {mark === "bolt" ? (
            <BoltMark className="tm-flash__bolt" />
          ) : (
            <Icon name="check" decorative className="tm-flash__icon" />
          )}
        </span>
      </div>
    </div>
  );
}
