// The job row (#76): components.css .tm-jobrow. My jobs and "Your jobs" on a phone (screens.html cus-myjobs,
// cus-home, tr-mywork); "Needs you" on a computer (pages.html w-c-home), where it's taller with the pill above the
// title and a big price. Which layout is the row's own width, not the screen's: 560px and up is the big one.
//
//   <JobRow href={`/jobs/${job.id}`} title="Sub wiring" category="Electrical" meta="Posted Tue · Windsor"
//     photo={job.thumbUrl} status={<StatusPill status={job.status} audience="customer" />} price="$372.00" />
//
// One link (the title, stretched over the row): a click anywhere opens the job. `action` is a kit button for
// the row's one next step ("See price", "Check & rate"); it sits above the link so it can be pressed by itself.
// Hover: M03 (it rises). The title stays on one line with "…"; the whole title is its tooltip and its name.
import Link from "next/link";
import type { ReactNode } from "react";

import { BoltMark } from "@/components/BoltMark";

import styles from "./cards.module.css";

export type JobRowProps = {
  href: string;
  title: string;
  /** The line above the title: the trade ("Electrical"). */
  category?: string;
  /** The line under the title: "Posted Tue · Windsor", "TM-1005 · Windsor". */
  meta?: string;
  /** Without one: Forest with the bolt. Decorative. */
  photo?: string | null;
  /** A <StatusPill> (or <Pill>): under the title on a phone, above it on a computer. */
  status?: ReactNode;
  /** "$372.00", once it's known. Customers never see estimates (AGENTS.md): pass only real prices. */
  price?: string;
  /** One kit button: the row's next step. */
  action?: ReactNode;
  /** The title's heading level, to fit the page's outline. Default 3. */
  headingLevel?: 2 | 3 | 4;
  className?: string;
};

export function JobRow({ href, title, category, meta, photo, status, price, action, headingLevel = 3, className }: JobRowProps) {
  const Heading = `h${headingLevel}` as const;
  return (
    <article className={["tm-lift", styles.row, className].filter(Boolean).join(" ")}>
      <div className={styles.rowInner}>
        <span className={styles.rowThumb} data-empty={photo ? undefined : true} aria-hidden="true">
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element -- job photos come from storage at thumbnail size
            <img src={photo} alt="" loading="lazy" decoding="async" />
          ) : (
            <BoltMark />
          )}
        </span>
        <div className={styles.rowBody} data-pill-first>
          {category && <span className={styles.rowCat}>{category}</span>}
          <Heading className={styles.tileHeading}>
            <Link href={href} className={`${styles.rowTitle} ${styles.stretched}`} title={title}>
              {title}
            </Link>
          </Heading>
          {meta && <span className={styles.rowMeta}>{meta}</span>}
          {status && <span className={styles.rowStatus}>{status}</span>}
        </div>
        {(price || action) && (
          <div className={styles.rowEnd}>
            {price && <span className={styles.rowPrice}>{price}</span>}
            {action && <span className={styles.rowAction}>{action}</span>}
          </div>
        )}
      </div>
    </article>
  );
}
