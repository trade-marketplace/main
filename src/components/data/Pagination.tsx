"use client";
// Pagination (#80): web.css .w-pager. "Showing 1–25 of 128" and Previous / Next, the office tables' footer
// (WEBAPP_SPEC: 25 per page). Put it in the table's `footer`, or under any list.
//
//   <Pagination page={page} pageSize={25} total={128} getHref={(p) => `/admin/jobs?page=${p}`} />   links (the URL keeps the page)
//   <Pagination page={page} pageSize={25} total={128} onPageChange={setPage} />                    buttons
//
// Prefer links: Back, refresh and a shared link then show the same page. A page past the end shows the last one.
import { Button } from "@/components/Button";
import { pageInfo, showingText } from "@/lib/data-table";

import styles from "./data.module.css";

type Common = {
  /** 1-based. */
  page: number;
  pageSize: number;
  /** Rows in the whole (filtered) list, not just this page. */
  total: number;
  /** What the pages are of, for screen readers: "Jobs". Default "Pages". */
  label?: string;
  className?: string;
};

export type PaginationProps = Common &
  ({ getHref: (page: number) => string; onPageChange?: never } | { onPageChange: (page: number) => void; getHref?: never });

const numberFormat = new Intl.NumberFormat("en-NZ");

export function Pagination({ page, pageSize, total, label, className, ...go }: PaginationProps) {
  const info = pageInfo(page, pageSize, total);
  const text = showingText(info);
  const range = info.from === info.to ? numberFormat.format(info.from) : `${numberFormat.format(info.from)}–${numberFormat.format(info.to)}`;

  const step = (to: number, name: "Previous" | "Next", enabled: boolean) => {
    const aria = `${name} page`;
    // A link can't be disabled, so at either end it's a disabled button that stays in place.
    if (!enabled) {
      return (
        <Button variant="secondary" size="sm" width="auto" disabled aria-label={aria}>
          {name}
        </Button>
      );
    }
    return "getHref" in go && go.getHref ? (
      <Button variant="secondary" size="sm" width="auto" href={go.getHref(to)}>
        <span aria-hidden="true">{name}</span>
        <span className={styles.visuallyHidden}>{aria}</span>
      </Button>
    ) : (
      <Button variant="secondary" size="sm" width="auto" aria-label={aria} onClick={() => go.onPageChange?.(to)}>
        {name}
      </Button>
    );
  };

  return (
    <nav aria-label={label ?? "Pages"} className={[styles.pager, className].filter(Boolean).join(" ")}>
      {/* Read out when the page changes, so pressing Next says where you are. */}
      <span role="status">
        {info.total === 0 ? (
          text
        ) : (
          <>
            Showing <b>{range}</b> of {numberFormat.format(info.total)}
          </>
        )}
      </span>
      {info.pageCount > 1 && (
        <span className={styles.pagerButtons}>
          {step(info.page - 1, "Previous", info.hasPrevious)}
          {step(info.page + 1, "Next", info.hasNext)}
        </span>
      )}
    </nav>
  );
}
