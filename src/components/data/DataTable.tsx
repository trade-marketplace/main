"use client";

import { type ReactNode, useLayoutEffect, useRef } from "react";

import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { EmptyState, ErrorState, LoadingRegion, SkeletonText } from "@/components/feedback";
import { CheckboxField } from "@/components/forms";

import styles from "./data.module.css";

export type TableSort = { key: string; direction: "asc" | "desc" };
export type TableColumn<Row> = { key: string; label: string; render: (row: Row) => ReactNode; sortable?: boolean };
export type DataTableProps<Row> = {
  caption: string;
  rows: readonly Row[];
  columns: readonly TableColumn<Row>[];
  rowKey: (row: Row) => string;
  rowLabel: (row: Row) => string;
  sort?: TableSort;
  /** Sort the whole data set before pagination, or request sorted rows from the server. */
  onSort?: (sort: TableSort) => void;
  selection?: { keys: readonly string[]; onChange: (keys: string[]) => void; actions?: ReactNode };
  isRowDisabled?: (row: Row) => boolean;
  rowActions?: (row: Row) => ReactNode;
  loading?: boolean;
  error?: string;
  onRetry?: () => unknown;
  disabled?: boolean;
  emptyAction?: ReactNode;
};

function SelectionCheckbox({ label, checked, mixed = false, disabled, onChange }: {
  label: string; checked: boolean; mixed?: boolean; disabled?: boolean; onChange: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => { if (input.current) input.current.indeterminate = mixed; }, [mixed]);
  return <CheckboxField ref={input} className={styles.selectionCheck} label={label} checked={checked}
    disabled={disabled} onChange={onChange} aria-checked={mixed ? "mixed" : checked} />;
}

/** Semantic table, sticky column headers, and labelled cards below 600px. Selection is controlled across pages. */
export function DataTable<Row>({ caption, rows, columns, rowKey, rowLabel, sort, onSort, selection, rowActions,
  isRowDisabled, loading = false, error, onRetry, disabled = false, emptyAction }: DataTableProps<Row>) {
  const available = rows.filter((row) => !isRowDisabled?.(row)).map(rowKey);
  const selected = new Set(selection?.keys ?? []);
  const selectedHere = available.filter((key) => selected.has(key)).length;
  const toggleAll = () => {
    if (!selection || disabled) return;
    if (selectedHere === available.length) available.forEach((key) => selected.delete(key));
    else available.forEach((key) => selected.add(key));
    selection.onChange([...selected]);
  };
  return <div className={styles.tableCard}>
    {selection && <div className={styles.bulk}>
      <span role="status">{selection.keys.length} selected</span>
      {selection.keys.length > 0 && <>
        <Button variant="tertiary" disabled={disabled || loading || Boolean(error)} onClick={() => selection.onChange([])}>Clear selection</Button>
        {selection.actions}
      </>}
    </div>}
    <LoadingRegion loading={loading} label={`Loading ${caption.toLowerCase()}`} skeleton={<div className={styles.tableState}><SkeletonText lines={6} /></div>}>
      {error ? <ErrorState title="Couldn't load the rows." message={error} onRetry={onRetry} />
        : rows.length === 0 ? <EmptyState icon="search_off" title="No jobs match that." message="Try fewer filters." action={emptyAction} />
        : <div className={styles.tableScroll} role="region" aria-label={`${caption} rows`} tabIndex={0}>
          <table role="table" className={styles.table}>
            <caption className={styles.srOnly}>{caption}</caption>
            <thead role="rowgroup"><tr role="row">
              {selection && <th role="columnheader" scope="col" className={styles.selectCell}>
                <SelectionCheckbox label="Select all rows on this page" checked={available.length > 0 && selectedHere === available.length}
                  mixed={selectedHere > 0 && selectedHere < available.length} disabled={disabled || available.length === 0} onChange={toggleAll} />
              </th>}
              {columns.map((column) => <th key={column.key} role="columnheader" scope="col"
                aria-sort={sort?.key === column.key ? sort.direction === "asc" ? "ascending" : "descending" : undefined}>
                {column.sortable && onSort ? <button className={styles.sort} type="button" disabled={disabled}
                  onClick={() => onSort({ key: column.key, direction: sort?.key === column.key && sort.direction === "asc" ? "desc" : "asc" })}>
                  {column.label}<Icon name={sort?.key === column.key ? sort.direction === "asc" ? "arrow_upward" : "arrow_downward" : "unfold_more"} size="sm" decorative />
                </button> : column.label}
              </th>)}
              {rowActions && <th role="columnheader" scope="col">Actions</th>}
            </tr></thead>
            <tbody role="rowgroup">{rows.map((row) => {
              const key = rowKey(row);
              const blocked = disabled || isRowDisabled?.(row);
              return <tr key={key} role="row" data-selected={selected.has(key) || undefined} aria-disabled={blocked || undefined}>
                {selection && <td role="cell" className={styles.selectCell}><SelectionCheckbox label={`Select ${rowLabel(row)}`} checked={selected.has(key)}
                  disabled={blocked} onChange={() => {
                    if (blocked) return;
                    if (selected.has(key)) selected.delete(key); else selected.add(key);
                    selection.onChange([...selected]);
                  }} /></td>}
                {columns.map((column) => <td key={column.key} role="cell"><span aria-hidden="true" className={styles.mobileLabel}>{column.label}</span>
                  <div className={styles.cellContent}>{column.render(row)}</div></td>)}
                {rowActions && <td role="cell"><span aria-hidden="true" className={styles.mobileLabel}>Actions</span>
                  <fieldset disabled={blocked} className={styles.rowActions}>{rowActions(row)}</fieldset></td>}
              </tr>;
            })}</tbody>
          </table>
        </div>}
    </LoadingRegion>
  </div>;
}
