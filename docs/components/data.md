# Tables, tabs, pagination and filters

Issue #80. Import from `@/components/data`. Open `/dev/components/data` in development for a working example,
or add `?mode=customer|trade|office&state=default|loading|empty|error|disabled|selected|filtered|long` to review a state.
The page uses the existing dev-page guard and is unavailable on deployed sites.

- `DataTable<Row>` takes columns (`key`, `label`, `render`, `sortable`), `rows`, `rowKey` and `rowLabel`.
  Supply `sort` / `onSort`, `selection` (`keys`, `onChange`, optional bulk `actions`) and `rowActions` as needed.
  Selection spans pages; Select all affects only enabled rows on the current page. `isRowDisabled` disables
  individual rows. `loading`, `error` / `onRetry`, and `emptyAction` use the existing feedback kit.
- `Tabs` and `SegmentedControl` take `label`, `items`, `value` and `onChange`. Each item has `value`, `label`,
  `content` and optional `disabled`. Arrows activate adjacent available tabs, wrapping at either end; Home/End
  activate the first/last. Tab enters the selected panel. Both variants use the existing M16 indicator utility
  and respect reduced motion.
- `Pagination` takes `total`, `page`, `pageSize` and `onPageChange`; optionally `onPageSizeChange`. Zero results
  show `0–0 of 0`; out-of-range pages are clamped for display. Keep the caller's page in range when results change.
- `FilterBar` takes filter definitions, a `value` (`search`, `values`) and `onChange`. Active chips remove one
  filter; Reset removes all. Pass `savedFilters`, `onSave` and `onDeleteSaved` for saved sets. The caller owns
  persistence. The gallery uses browser storage for its example strings and falls back to memory when storage
  is unavailable; production pages should persist filters per account through their own data layer.

Sort and filter the entire result set before pagination (or fetch the corresponding server result). Reset the page
when a filter, sort, page size or tab changes. Clear selection when its result scope changes; preserve it across
pages. The working example demonstrates each of these choices without a database.

The table follows `docs/design/web.css`'s office table and pager, and `components.css`'s tabs and segmented control.
Headers stay sticky inside the scroll region. On phones rows become labelled cards while header controls remain
available. Full text wraps, including unbroken strings; there is no tooltip needed to recover clipped content.
The five required viewport widths, text enlargement, keyboard, sticky headers, axe and interactive behavior are
covered in `tests/e2e/dev-data.spec.ts`. Run with `E2E_DEV_BASE_URL=http://localhost:3000` against a dev server.
