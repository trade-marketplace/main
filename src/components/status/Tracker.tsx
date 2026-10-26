"use client";
// The job tracker (components.css `.tm-track`): done / now / to-do steps down a line. Build the steps with
// jobTracker() (src/lib/job-tracker.ts) or pass your own.
// M11: when `current` moves on while the page is open, the line fills down to the new step (400ms), then its dot
// pops and its label fades in. The first render never animates (a refresh doesn't replay it); reduced motion
// makes it instant (src/styles/motion.css).
// Put it on a white surface (a card): the to-do grey (--trade-text-3) only meets 4.5:1 on white.
// Screen readers hear each step's state as words ("Done", "Now", "To do") and the list's name, never just colour.
import { Icon } from "@/components/Icon";
import type { TrackerStep } from "@/lib/job-tracker";
import { wentUp } from "@/lib/motion/helpers";
import { useBump } from "@/lib/motion/hooks";

import styles from "./status.module.css";

export type TrackerProps = {
  steps: readonly TrackerStep[];
  /** The step happening now (0-based). `steps.length` means all done. */
  current: number;
  /** The list's accessible name. */
  label?: string;
  className?: string;
};

const STATE_WORDS = { done: "Done", now: "Now", todo: "To do" } as const;

export function Tracker({ steps, current, label = "Job progress", className }: TrackerProps) {
  const at = Math.max(0, Math.min(current, steps.length));
  const run = useBump(at, wentUp);

  return (
    <ol className={[styles.track, className].filter(Boolean).join(" ")} aria-label={label}>
      {steps.map((step, i) => {
        const state = i < at ? "done" : i === at ? "now" : "todo";
        // Only the step that was just reached (and the line into it) replays, keyed by the run count.
        const fresh = run > 0 && i === at;
        const freshLine = run > 0 && i === at - 1;
        return (
          <li
            key={`${i}-${step.label}`}
            className={styles.step}
            data-state={state}
            aria-current={state === "now" ? "step" : undefined}
          >
            {i < steps.length - 1 ? (
              <span className={styles.line} aria-hidden="true">
                {i < at ? (
                  <span key={freshLine ? run : 0} className={[styles.lineFill, freshLine && "tm-anim-fill"].filter(Boolean).join(" ")} />
                ) : null}
              </span>
            ) : null}
            <span key={fresh ? `d${run}` : "d"} className={[styles.dot28, fresh && "tm-anim-step-dot"].filter(Boolean).join(" ")} aria-hidden="true">
              {state === "done" ? <Icon name="check" decorative className={styles.dotIcon} /> : null}
            </span>
            <span key={fresh ? `l${run}` : "l"} className={[styles.stepBody, fresh && "tm-anim-step-label"].filter(Boolean).join(" ")}>
              <span className={styles.srOnly}>{STATE_WORDS[state]}: </span>
              <span className={styles.stepLabel}>{step.label}</span>
              {step.note ? <span className={styles.stepNote}>{step.note}</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
