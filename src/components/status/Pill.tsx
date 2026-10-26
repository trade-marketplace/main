// One pill, coloured by meaning (components.css `.tm-status`). Most screens want <StatusPill> (a job's status)
// or <BountyPill>; use this directly for the other pills in the kit (Paid, Refunded, Checking…).
// The meaning is always in the text, never only in the colour.
import type { ReactNode } from "react";

import { Icon } from "@/components/Icon";
import type { PillKind } from "@/lib/job-status";

import styles from "./status.module.css";

export type PillProps = {
  kind: PillKind;
  children: ReactNode;
  /**
   * Long labels wrap by default. `truncate` keeps one line with an ellipsis and puts the full label in a tooltip
   * (screen readers always get the full label). Give it a string child.
   */
  truncate?: boolean;
  /** M27: the gold glint every 4s. Bounty pills only. */
  glint?: boolean;
  className?: string;
  "aria-hidden"?: boolean;
};

const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(" ");

export function Pill({ kind, children, truncate = false, glint = false, className, ...rest }: PillProps) {
  const title = truncate && typeof children === "string" ? children : undefined;
  return (
    <span
      className={cx(styles.pill, styles[kind], truncate && styles.truncate, glint && cx("tm-glint", styles.glint), className)}
      data-kind={kind}
      title={title}
      aria-hidden={rest["aria-hidden"] || undefined}
    >
      {kind === "bounty" ? (
        <Icon name="paid" fill decorative className={styles.icon} />
      ) : (
        <span className={styles.dot} aria-hidden="true" />
      )}
      <span className={styles.text}>{children}</span>
    </span>
  );
}
