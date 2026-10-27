"use client";
// Office tables (#80): web.css .w-tablecard / .w-table. Sortable columns, a header that sticks while the list
// scrolls, row actions, ticking rows for a bulk action, the row that's open in the detail view, and the loading,
// empty and error states. Below 640px wide (the card's width, not the screen's) every row becomes a card with the
// column names beside the values: WEBAPP_SPEC "on a phone tables become cards".
//
//   <DataTable
//     caption="All jobs"
//     rows={jobs}
//     rowId={(job) => job.id}
//     rowLabel={(job) => job.title}
//     columns={[
//       { key: "job", header: "Job", primary: true, cell: (job) => <TableItem title={job.title} href={`/admin/jobs/${job.id}`} … /> },
//       { key: "price", header: "Price", sortable: true, firstSort: "desc", cell: (job) => money(job.priceCents) },
//     ]}
//     sort={sort} onSortChange={setSort}            // the table shows the order; the page (or server) sorts
//     selectable selected={ticked} onSelectedChange={setTicked} bulkActions={<Button size="sm">Export</Button>}
//     rowActions={(job) => <Menu trigger={…}>…</Menu>}
//     rowHref={(job) => `/admin/jobs/${job.id}`} activeRowId={openJobId}
//     footer={<Pagination … />}
//   />
//
// The table never sorts, filters or pages by itself: it shows what it's given, so the same table works for a
// list sorted in the browser (sortRows from src/lib/data-table.ts) and one sorted by the database.
import {
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
} from "react";

import Link from "next/link";

import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { LiveMessage, Skeleton } from "@/components/feedback";
import { Menu, MenuItem } from "@/components/overlays";
import {
  ariaSort,
  nextSort,
  selectAllState,
  selectedText,
  selectRange,
  type SortDirection,
  type SortState,
  toggleAll,
} from "@/lib/data-table";
import { MOTION_MS } from "@/lib/motion/timings";

import styles from "./data.module.css";

export type Column<Row> = {
  /** Unique per table; it's also the sort key handed to onSortChange. */
  key: string;
  /** The column name. On a phone it's the label beside each value. */
  header: string;
  cell: (row: Row) => ReactNode;
  /** Shows a sort button in the header. */
  sortable?: boolean;
  /** The direction a first click sorts by. "desc" for dates and money (newest, biggest first). Default "asc". */
  firstSort?: SortDirection;
  /** The words for each direction in the phone's Sort menu. Default ["A to Z", "Z to A"]. */
  sortLabels?: readonly [asc: string, desc: string];
  /** "end" for numbers you compare down the column. Default "start". */
  align?: "start" | "end";
  /**
   * Long values stay on one line with "…" and the whole value in a tooltip (and for screen readers). Give
   * `text` too. Without it, long values wrap, which is right for most cells.
   */
  truncate?: boolean;
  /** The cell as plain text: the tooltip for truncated cells. */
  text?: (row: Row) => string;
  /** The row's title (job, person). On a phone it heads the card. One per table. */
  primary?: boolean;
  /** Steps aside when the table is between 640 and 960px wide, so the rest fit. Still shown on the phone cards. */
  optional?: boolean;
  /** A fixed width, e.g. "160px". Most columns size themselves. */
  width?: string;
  /** Never wrap (status pills, money, dates): other columns give way instead. */
  nowrap?: boolean;
};

export type DataTableProps<Row> = {
  /** What the table lists ("All jobs"). Its accessible name; shown above it only with showCaption. */
  caption: string;
  showCaption?: boolean;
  columns: readonly Column<Row>[];
  rows: readonly Row[];
  rowId: (row: Row) => string;
  /** The row in a few words, for the tick box's name: "Select Sub wiring". */
  rowLabel: (row: Row) => string;

  sort?: SortState;
  onSortChange?: (sort: SortState) => void;

  /** Tick boxes on each row and a select-all for the page. Shift+click ticks a run of rows. */
  selectable?: boolean;
  selected?: ReadonlySet<string>;
  onSelectedChange?: (selected: Set<string>) => void;
  /** Kit buttons for the ticked rows, in the bar that appears above the table ("3 selected"). */
  bulkActions?: ReactNode;

  /** The last cell of each row: one kit button ("Price it") or a <Menu> of actions. */
  rowActions?: (row: Row) => ReactNode;
  /** The name of the actions column, for screen readers. Default "Actions". */
  actionsLabel?: string;

  /**
   * Clicking anywhere on the row (not on a button or tick box) opens this. Put a real link to the same place in
   * the primary cell (<TableItem href>) so keyboard and screen reader users can open it too.
   */
  rowHref?: (row: Row) => string;
  /** The row that's open in the detail view: tinted, and aria-current. */
  activeRowId?: string | null;

  /** Shows skeleton rows (after 300ms, M15) and says `loadingLabel` to screen readers. */
  loading?: boolean;
  loadingLabel?: string;
  /** How many skeleton rows. Default 5. */
  skeletonRows?: number;
  /** An <ErrorState> from the kit, shown in place of the rows. */
  error?: ReactNode;
  /** An <EmptyState> from the kit, shown when there are no rows (and it isn't loading or failed). */
  empty?: ReactNode;

  /** Under the rows inside the card: <Pagination>. */
  footer?: ReactNode;
  /**
   * How far from the top of the screen the header sticks: the height of a sticky app bar above it (68px under
   * the desktop app nav). Default 0.
   */
  stickyTop?: number | string;
  className?: string;
};

const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(" ");

/** Rows aren't opened by a click on something that does its own thing, or by selecting text in them. */
const INTERACTIVE = "a, button, input, select, textarea, label, summary, [role='menu'], [role='menuitem'], [role='menuitemradio']";

export function DataTable<Row>({
  caption,
  showCaption = false,
  columns,
  rows,
  rowId,
  rowLabel,
  sort = null,
  onSortChange,
  selectable = false,
  selected,
  onSelectedChange,
  bulkActions,
  rowActions,
  actionsLabel = "Actions",
  rowHref,
  activeRowId,
  loading = false,
  loadingLabel = `Loading ${caption.toLowerCase()}`,
  skeletonRows = 5,
  error,
  empty,
  footer,
  stickyTop,
  className,
}: DataTableProps<Row>) {
  const captionId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const bulkRef = useRef<HTMLDivElement>(null);
  const anchor = useRef<string | null>(null);

  const ticked = selected ?? new Set<string>();
  const ids = rows.map(rowId);
  const showRows = !loading && !error && rows.length > 0;
  const allState = selectAllState(ids, ticked);
  const tickedHere = ids.filter((id) => ticked.has(id)).length;
  const showBulk = selectable && showRows && tickedHere > 0;
  const span = columns.length + (selectable ? 1 : 0) + (rowActions ? 1 : 0);
  const sortable = columns.filter((column) => column.sortable);

  // The header sticks under the bulk bar while it shows: measure the bar (it can wrap onto two lines).
  useLayoutEffect(() => {
    const card = cardRef.current;
    const bar = bulkRef.current;
    if (!card) return;
    if (!bar) {
      card.style.removeProperty("--tm-bulk-height");
      return;
    }
    const measure = () => card.style.setProperty("--tm-bulk-height", `${bar.offsetHeight}px`);
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(bar);
    return () => observer?.disconnect();
  }, [showBulk]);

  const setTicked = (next: Set<string>) => onSelectedChange?.(next);

  const onRowClick = (event: MouseEvent<HTMLTableRowElement>, row: Row) => {
    if (!rowHref) return;
    const target = event.target as HTMLElement;
    if (target.closest(INTERACTIVE) || window.getSelection()?.toString()) return;
    const link = event.currentTarget.querySelector<HTMLAnchorElement>("a[data-row-link]");
    if (link) link.click();
    else window.location.assign(rowHref(row));
  };

  const style = stickyTop === undefined ? undefined : ({ "--tm-table-top": typeof stickyTop === "number" ? `${stickyTop}px` : stickyTop } as CSSProperties);

  return (
    <div
      ref={cardRef}
      className={cx(styles.tableCard, className)}
      style={style}
      data-bulk={showBulk || undefined}
      data-footer={footer ? true : undefined}
    >
      {showBulk && (
        <div ref={bulkRef} className={styles.bulkBar} role="region" aria-label={`Bulk actions for ${caption.toLowerCase()}`}>
          <span className={styles.bulkCount}>{selectedText(tickedHere)}</span>
          <div className={styles.bulkActions}>
            {bulkActions}
            <Button variant="tertiary" onClick={() => setTicked(new Set())}>
              Clear selection
            </Button>
          </div>
        </div>
      )}
      <LiveMessage message={selectable && showRows ? (tickedHere > 0 ? selectedText(tickedHere) : null) : null} />

      {(showRows && (selectable || (sortable.length > 0 && onSortChange))) && (
        <div className={styles.cardTools}>
          {selectable && (
            <Checkbox
              label="Select all"
              visibleLabel
              checked={allState === "all"}
              indeterminate={allState === "some"}
              onChange={() => setTicked(toggleAll(ids, ticked))}
            />
          )}
          {sortable.length > 0 && onSortChange && <SortMenu columns={sortable} sort={sort} onSortChange={onSortChange} />}
        </div>
      )}

      <table
        className={styles.table}
        role="table"
        aria-labelledby={captionId}
        aria-busy={loading || undefined}
        aria-rowcount={showRows ? rows.length + 1 : undefined}
      >
        <caption id={captionId} className={showCaption ? styles.caption : styles.visuallyHidden}>
          {caption}
        </caption>
        <thead role="rowgroup">
          <tr role="row">
            {selectable && (
              <th role="columnheader" scope="col" className={cx(styles.th, styles.selectCell)}>
                <Checkbox
                  label="Select all rows on this page"
                  checked={showRows && allState === "all"}
                  indeterminate={showRows && allState === "some"}
                  disabled={!showRows}
                  onChange={() => setTicked(toggleAll(ids, ticked))}
                />
                <span className={styles.thText}>Select</span>
              </th>
            )}
            {columns.map((column) => (
              <th
                key={column.key}
                role="columnheader"
                scope="col"
                className={styles.th}
                data-align={column.align === "end" ? "end" : undefined}
                data-optional={column.optional || undefined}
                aria-sort={column.sortable ? ariaSort(sort, column.key) : undefined}
                style={column.width ? { width: column.width } : undefined}
              >
                {column.sortable && onSortChange ? (
                  <>
                    <SortButton column={column} sort={sort} onSortChange={onSortChange} />
                    <span className={styles.thText}>{column.header}</span>
                  </>
                ) : (
                  column.header
                )}
              </th>
            ))}
            {rowActions && (
              <th role="columnheader" scope="col" className={cx(styles.th, styles.actionsCell)}>
                <span className={styles.visuallyHidden}>{actionsLabel}</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody role="rowgroup">
          {loading ? (
            Array.from({ length: skeletonRows }, (_, index) => (
              <tr key={index} role="row" className={cx(styles.row, styles.skeletonRow)} aria-hidden="true">
                {selectable && <td role="cell" className={cx(styles.td, styles.selectCell, styles.skeletonCell)} />}
                {columns.map((column) => (
                  <td
                    key={column.key}
                    role="cell"
                    className={cx(styles.td, styles.skeletonCell)}
                    data-primary={column.primary || undefined}
                    data-optional={column.optional || undefined}
                  >
                    {column.primary ? (
                      <span className={styles.item}>
                        <Skeleton width={40} height={40} />
                        <span className={styles.itemText} style={{ gap: 6, flex: 1 }}>
                          <Skeleton width="70%" height={14} />
                          <Skeleton width="45%" height={10} />
                        </span>
                      </span>
                    ) : (
                      <Skeleton width={index % 2 ? "60%" : "80%"} height={14} />
                    )}
                  </td>
                ))}
                {rowActions && <td role="cell" className={cx(styles.td, styles.actionsCell, styles.skeletonCell)} />}
              </tr>
            ))
          ) : !showRows ? (
            <tr role="row" className={styles.row}>
              <td role="cell" colSpan={span} className={cx(styles.td, styles.messageCell)}>
                {error ?? empty}
              </td>
            </tr>
          ) : (
            rows.map((row, index) => {
              const id = ids[index];
              const isTicked = ticked.has(id);
              const href = rowHref?.(row);
              return (
                <tr
                  key={id}
                  role="row"
                  className={styles.row}
                  data-checked={isTicked || undefined}
                  data-href={href}
                  aria-current={activeRowId === id ? "true" : undefined}
                  onClick={href ? (event) => onRowClick(event, row) : undefined}
                >
                  {selectable && (
                    <td role="cell" className={cx(styles.td, styles.selectCell)}>
                      <Checkbox
                        label={`Select ${rowLabel(row)}`}
                        checked={isTicked}
                        onChange={(shiftKey) => {
                          setTicked(shiftKey ? selectRange(ids, ticked, anchor.current, id) : toggle(ticked, id));
                          anchor.current = id;
                        }}
                      />
                    </td>
                  )}
                  {columns.map((column) => (
                    <Cell key={column.key} column={column} row={row} />
                  ))}
                  {rowActions && (
                    <td role="cell" className={cx(styles.td, styles.actionsCell)}>
                      <div className={styles.actions}>{rowActions(row)}</div>
                    </td>
                  )}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
      <LiveMessage message={loading ? loadingLabel : null} delay={MOTION_MS.m15Delay} />

      {footer && <div className={styles.footer}>{footer}</div>}
    </div>
  );
}

function toggle(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

function Cell<Row>({ column, row }: { column: Column<Row>; row: Row }) {
  const content = column.cell(row);
  const text = column.truncate ? column.text?.(row) : undefined;
  return (
    <td
      role="cell"
      className={styles.td}
      data-align={column.align === "end" ? "end" : undefined}
      data-primary={column.primary || undefined}
      data-field={column.primary ? undefined : true}
      data-label={column.primary ? undefined : column.header}
      data-optional={column.optional || undefined}
      data-truncate={column.truncate || undefined}
      data-nowrap={column.nowrap || undefined}
    >
      {column.truncate ? (
        <span className={styles.truncate} title={text}>
          {content}
        </span>
      ) : (
        content
      )}
    </td>
  );
}

function SortButton<Row>({ column, sort, onSortChange }: { column: Column<Row>; sort: SortState; onSortChange: (sort: SortState) => void }) {
  const direction = sort?.key === column.key ? sort.direction : null;
  const icon = direction === "asc" ? "arrow_upward" : direction === "desc" ? "arrow_downward" : "swap_vert";
  return (
    <button
      type="button"
      className={styles.sortButton}
      data-sorted={direction !== null}
      onClick={() => onSortChange(nextSort(sort, column.key, column.firstSort))}
    >
      {column.header}
      <Icon name={icon} size="sm" decorative className={styles.sortIcon} />
    </button>
  );
}

const DEFAULT_SORT_LABELS = ["A to Z", "Z to A"] as const;

/** On the phone cards there are no headers to click: the same choices are in a menu. */
function SortMenu<Row>({ columns, sort, onSortChange }: { columns: readonly Column<Row>[]; sort: SortState; onSortChange: (sort: SortState) => void }) {
  const current = columns.find((column) => column.key === sort?.key);
  const labels = (column: Column<Row>) => column.sortLabels ?? DEFAULT_SORT_LABELS;
  const currentText = current && sort ? `${current.header}, ${labels(current)[sort.direction === "asc" ? 0 : 1].toLowerCase()}` : "Default order";
  return (
    <Menu
      label="Sort by"
      trigger={(props) => (
        <button type="button" className={styles.chipButton} {...props} aria-label={`Sort: ${currentText}`}>
          <span className={styles.chip}>
            <Icon name="swap_vert" size="sm" decorative className={styles.chipIcon} />
            <span className={styles.chipLabel}>Sort</span>
            <Icon name="expand_more" size="sm" decorative className={cx(styles.chipIcon, styles.chipChevron)} />
          </span>
        </button>
      )}
    >
      {columns.flatMap((column) =>
        (["asc", "desc"] as const).map((direction) => (
          <MenuItem
            key={`${column.key}-${direction}`}
            checked={sort?.key === column.key && sort.direction === direction}
            onSelect={() => onSortChange({ key: column.key, direction })}
          >
            {column.header}: {labels(column)[direction === "asc" ? 0 : 1]}
          </MenuItem>
        )),
      )}
    </Menu>
  );
}

type CheckboxProps = {
  label: string;
  /** Show the label beside the box (the phone's "Select all"); otherwise it's for screen readers only. */
  visibleLabel?: boolean;
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  /** Called with whether Shift was held (Shift+click ticks a run of rows). */
  onChange: (shiftKey: boolean) => void;
};

function Checkbox({ label, visibleLabel = false, checked, indeterminate = false, disabled, onChange }: CheckboxProps) {
  const ref = useRef<HTMLInputElement>(null);
  const shift = useRef(false);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  const box = (
    <span className={styles.checkbox}>
      <input
        ref={ref}
        type="checkbox"
        className={styles.checkboxInput}
        aria-label={visibleLabel ? undefined : label}
        checked={checked}
        disabled={disabled}
        onClick={(event) => (shift.current = event.shiftKey)}
        onKeyDown={() => (shift.current = false)}
        onChange={() => onChange(shift.current)}
      />
      <span className={styles.checkboxBox} aria-hidden="true">
        <Icon name={indeterminate ? "remove" : "check"} size="sm" decorative />
      </span>
    </span>
  );
  if (!visibleLabel) return box;
  return (
    <label className={styles.checkboxLabel}>
      {box}
      {label}
    </label>
  );
}

export type TableItemProps = {
  title: string;
  /** The line under it: "TM-1005 · Electrical". */
  meta?: ReactNode;
  /** A photo URL: the 40px thumbnail. Decorative (the title says what it is). */
  image?: string;
  /** Makes the title the row's link (the row's own click opens it too, when the table has rowHref). */
  href?: string;
  /** Marks the link as the page that's open (aria-current) when the row is the one in the detail view. */
  current?: boolean;
};

/** The Job column of the office mockups: thumbnail, bold title, and a caption line. */
export function TableItem({ title, meta, image, href, current }: TableItemProps) {
  return (
    <span className={styles.item}>
      {image !== undefined && (
        // eslint-disable-next-line @next/next/no-img-element -- 40px thumbnails from storage, already small
        <img className={styles.itemThumb} src={image} alt="" width={40} height={40} loading="lazy" />
      )}
      <span className={styles.itemText}>
        {href ? (
          <Link className={styles.itemTitle} href={href} data-row-link aria-current={current ? "page" : undefined}>
            {title}
          </Link>
        ) : (
          <b className={styles.itemTitle}>{title}</b>
        )}
        {meta && <span className={styles.itemMeta}>{meta}</span>}
      </span>
    </span>
  );
}
