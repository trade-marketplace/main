"use client";

import { Button, IconButton } from "@/components/Button";
import { SelectField } from "@/components/forms";

import { pagination } from "./page-range";
import styles from "./data.module.css";

export type PaginationProps = {
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  disabled?: boolean;
  label?: string;
};

export function Pagination({ total, page, pageSize, onPageChange, onPageSizeChange, disabled, label = "Pagination" }: PaginationProps) {
  const range = pagination(total, pageSize, page);
  return <nav aria-label={label} className={styles.pager}>
    <p aria-live="polite" aria-atomic="true"><b>{range.start}–{range.end}</b> of {range.total}</p>
    {onPageSizeChange && <SelectField label="Rows per page" value={pageSize} disabled={disabled}
      onChange={(event) => onPageSizeChange(Number(event.target.value))}>
      {[...new Set([10, 25, 50, pageSize])].sort((a, b) => a - b).map((size) => <option key={size} value={size}>{size}</option>)}
    </SelectField>}
    <div className={styles.pageLinks}>
      <IconButton icon="chevron_left" label="Previous page" disabled={disabled || range.page === 1}
        onClick={() => onPageChange(range.page - 1)} />
      {range.links.map((link) => typeof link === "number"
        ? <Button key={link} variant={link === range.page ? "primary" : "tertiary"} size="sm" width="auto"
          aria-label={`Page ${link}`} aria-current={link === range.page ? "page" : undefined} disabled={disabled}
          onClick={() => onPageChange(link)}>{link}</Button>
        : <span key={link} aria-hidden="true">…</span>)}
      <IconButton icon="chevron_right" label="Next page" disabled={disabled || range.page === range.pages}
        onClick={() => onPageChange(range.page + 1)} />
    </div>
  </nav>;
}
