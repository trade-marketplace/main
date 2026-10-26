// Empty states (#79), .tm-empty: an illustration (or an icon), a short heading, one line and one action.
// Tone: friendly, not sorry. "Nothing on yet." not "No data found" (FRONTEND_SPEC "Empty state").
//
//   <EmptyState
//     illustration="van"
//     title="Nothing on yet."
//     message="Got something that needs doing? Post it free and we'll get you a price."
//     action={<Button href="/jobs/new">Post a job</Button>}
//   />
//   <EmptyState icon="search_off" title="No jobs match that." message="Try fewer filters."
//     action={<Button variant="secondary" onClick={reset}>Reset filters</Button>} />
import Image from "next/image";
import type { ReactNode } from "react";

import { Icon } from "@/components/Icon";

import styles from "./feedback.module.css";

export type HeadingLevel = 1 | 2 | 3 | 4;

export type EmptyStateProps = {
  /** Short and friendly: "Nothing on yet." */
  title: string;
  /** One line saying what to do next. */
  message?: ReactNode;
  /** One action, from the kit: a <Button> (or <TextLink>). Optional: some lists have nothing to do. */
  action?: ReactNode;
  /** A second, quieter action, e.g. a <TextLink>. */
  secondaryAction?: ReactNode;
  /** "van": the brand van (public/images/van.png). Decorative: the heading says what matters. */
  illustration?: "van";
  /** A Material Symbols name shown in a tinted square, when there's no illustration: "search_off", "inbox". */
  icon?: string;
  /** The heading level that fits the page outline. Default 2 (under the page's own h1). */
  headingLevel?: HeadingLevel;
  className?: string;
};

export function EmptyState({
  title,
  message,
  action,
  secondaryAction,
  illustration,
  icon,
  headingLevel = 2,
  className,
}: EmptyStateProps) {
  const Heading = `h${headingLevel}` as const;
  return (
    <div className={[styles.empty, className].filter(Boolean).join(" ")}>
      {illustration === "van" ? (
        <Image src="/images/van.png" alt="" width={500} height={350} className={styles.emptyArt} />
      ) : (
        icon && (
          <span className={styles.badge}>
            <Icon name={icon} decorative />
          </span>
        )
      )}
      <Heading className={styles.title}>{title}</Heading>
      {message && <p className={styles.message}>{message}</p>}
      {(action || secondaryAction) && (
        <div className={styles.actions}>
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}
