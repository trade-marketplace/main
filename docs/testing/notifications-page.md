# Notifications page — issue 180

`/notifications` now reads the full owned inbox, 25 rows per page, with All/Unread URL state and New Zealand calendar-day groups. The bell remains limited to eight rows. All page loads and reads use the checked customer/tradie identity; raw event payloads, prices and recipient identifiers never reach the browser. No schema, preferences, Auth configuration, provider or money behavior changed.

## References and kit inventory

Read the complete root `AGENTS.md`, `DECISIONS.md`, `docs/design/WEBAPP_SPEC.md`, assigned issue/comments and dependency #179 before implementation. There are no nested `AGENTS.md` files or `.agents/skills` directory in this checkout. The latest founder instruction supplied with this task supersedes older helper-copy guidance.

Before coding, actual Chromium inspected `pages.html#w-notifs` and `screens.html#sh-notifs` with both 1440 and 390 viewport settings. The desktop inventory has no E03 mockup; E02 is the closest desktop row/shell reference. Contrary to the inventory's blank mockup cell, the phone gallery does contain `sh-notifs`. Its 36px icons, compact list rows, heading and Mark all read action are used here. All/Unread and individual past-day headings come from the E03 requirements. Desktop uses the existing readable column and app shell. Existing shell navigation differs from the old illustrative browser/phone chrome; the mockup is not a pixel-perfect full-page desktop specification. No separate tradie, empty, error or loading mockups exist.

Existing kit reviewed:

| Category | Existing components/files |
|---|---|
| Buttons | Button, IconButton, TextLink |
| Fields | Field, TextFields, ChoiceFields, AddressField, TimeWindowPicker |
| Cards | CategoryTile, EmptyCard, JobRow, JobTile, ProfileCard, StatCards |
| Status | Pill, StatusPill, BountyPill, PriceBlock, Tracker |
| Overlays | Banner, Dialog, Drawer, Sheet, Menu, Toast |
| Feedback | EmptyState, ErrorState, LoadingRegion, Skeleton, OfflineBanner, LiveMessage, Progress |
| Data | Tabs, SegmentedControl, Pagination, DataTable, FilterBar, QuickFilters |
| Media | Avatar, DropZone, PhotoGallery, PhotoPicker, PhotoViewer, ProgressRing, Stars |
| Map | MapCard, MapListLayout, MapPin, MapSurface, MapboxSurface |
| Shells | AppShell/AppShellView, AppNav, SiteShell, OfficeShell |
| Tokens | docs/design/tokens.css and src/styles/tokens.css; existing notification row styles |

The page composes Button, Icon, Tabs, Pagination and feedback components, extends the existing notification module with reusable page/list classes, and uses mode tokens only. Customer Leaf/Lime; tradie Hi-Vis/Amber; coloured-button labels Forest. Named kit motion is reused: M15 skeleton delay and M16 tabs; no custom animation was introduced.

## Review routes and behavior

Guarded local/CI fixture: `/dev/components/notifications-page`. Add `mode=trade` for tradie. Both modes expose `state=default`, `read`, `empty`, `loading`, `error`, `offline`, `saving`, `expired`, `many`, `long`, and `read-error`. `filter=unread` selects unread; `state=many&page=2` reaches the final six of 31 synthetic rows. Click Mark all read in saving/expired to reach those states. The real route has no state flag or test identity.

Failed reads do not navigate or optimistically clear unread rows. Retry reloads confirmed state. Retrying a write is idempotent and preserves the first read timestamp. Mark all reads only owned rows through the server action's timestamp; later arrivals remain unread. Offline disables writes; reconnection reloads. A lost session opens the shared login dialog. URL navigation preserves tab focus and keyboard outlines; stale in-flight responses cannot navigate after changing page/filter.

Three actual signed-in browser tests used the normal SDK, checked page/server actions, a task-owned localhost Auth HTTP double, and disposable PostgreSQL. Customer desktop and tradie phone each logged in, opened bell → See all, paginated 25/6 rows, changed to Unread, followed a row, used Back, marked all read and reloaded. The database confirmed persistence and that the other inbox remained unchanged. The third test removed the session after render and confirmed no read writes. Existing job destinations are still the repository's 404 (separate job-workspace issues); the tests verify that destination and Back, without claiming its screen is implemented.

## Visual review

Two personally inspected passes preserve **48 same-size side-by-side pairs each**: 12 views × two modes × 1440/390. Original screenshot pixels are preserved; a white comparison canvas pads a possible one-pixel fractional phone-gallery height. Mockup left, build right. Phone-gallery navigation and the dev browser indicator are omitted from evidence; product DOM is unchanged. The initial default-screen comparison caught overly bold timestamps and excess initial spacing; the first full-state pass also caught a synthetic tradie portal palette. These were corrected. Pass 2 waits for the kit's 300ms skeleton delay and confirms static reduced-motion skeletons. Older rows show clock time instead of repeating their day heading. The loading wrapper also uses LoadingRegion after axe identified an invalid label on a generic div.

Full-resolution pairs are linked below; contact sheets are convenient indexes, not substitutes for original captures.

| View | Customer 1440 | Customer 390 | Tradie 1440 | Tradie 390 |
|---|---|---|---|---|
| default | [pair](../../output/playwright/issue-180/pass-2/pair-customer-default-1440.png) | [pair](../../output/playwright/issue-180/pass-2/pair-customer-default-390.png) | [pair](../../output/playwright/issue-180/pass-2/pair-trade-default-1440.png) | [pair](../../output/playwright/issue-180/pass-2/pair-trade-default-390.png) |
| unread | [pair](../../output/playwright/issue-180/pass-2/pair-customer-unread-1440.png) | [pair](../../output/playwright/issue-180/pass-2/pair-customer-unread-390.png) | [pair](../../output/playwright/issue-180/pass-2/pair-trade-unread-1440.png) | [pair](../../output/playwright/issue-180/pass-2/pair-trade-unread-390.png) |
| read | [pair](../../output/playwright/issue-180/pass-2/pair-customer-read-1440.png) | [pair](../../output/playwright/issue-180/pass-2/pair-customer-read-390.png) | [pair](../../output/playwright/issue-180/pass-2/pair-trade-read-1440.png) | [pair](../../output/playwright/issue-180/pass-2/pair-trade-read-390.png) |
| empty | [pair](../../output/playwright/issue-180/pass-2/pair-customer-empty-1440.png) | [pair](../../output/playwright/issue-180/pass-2/pair-customer-empty-390.png) | [pair](../../output/playwright/issue-180/pass-2/pair-trade-empty-1440.png) | [pair](../../output/playwright/issue-180/pass-2/pair-trade-empty-390.png) |
| loading | [pair](../../output/playwright/issue-180/pass-2/pair-customer-loading-1440.png) | [pair](../../output/playwright/issue-180/pass-2/pair-customer-loading-390.png) | [pair](../../output/playwright/issue-180/pass-2/pair-trade-loading-1440.png) | [pair](../../output/playwright/issue-180/pass-2/pair-trade-loading-390.png) |
| error | [pair](../../output/playwright/issue-180/pass-2/pair-customer-error-1440.png) | [pair](../../output/playwright/issue-180/pass-2/pair-customer-error-390.png) | [pair](../../output/playwright/issue-180/pass-2/pair-trade-error-1440.png) | [pair](../../output/playwright/issue-180/pass-2/pair-trade-error-390.png) |
| offline | [pair](../../output/playwright/issue-180/pass-2/pair-customer-offline-1440.png) | [pair](../../output/playwright/issue-180/pass-2/pair-customer-offline-390.png) | [pair](../../output/playwright/issue-180/pass-2/pair-trade-offline-1440.png) | [pair](../../output/playwright/issue-180/pass-2/pair-trade-offline-390.png) |
| saving | [pair](../../output/playwright/issue-180/pass-2/pair-customer-saving-1440.png) | [pair](../../output/playwright/issue-180/pass-2/pair-customer-saving-390.png) | [pair](../../output/playwright/issue-180/pass-2/pair-trade-saving-1440.png) | [pair](../../output/playwright/issue-180/pass-2/pair-trade-saving-390.png) |
| expired | [pair](../../output/playwright/issue-180/pass-2/pair-customer-expired-1440.png) | [pair](../../output/playwright/issue-180/pass-2/pair-customer-expired-390.png) | [pair](../../output/playwright/issue-180/pass-2/pair-trade-expired-1440.png) | [pair](../../output/playwright/issue-180/pass-2/pair-trade-expired-390.png) |
| many | [pair](../../output/playwright/issue-180/pass-2/pair-customer-many-1440.png) | [pair](../../output/playwright/issue-180/pass-2/pair-customer-many-390.png) | [pair](../../output/playwright/issue-180/pass-2/pair-trade-many-1440.png) | [pair](../../output/playwright/issue-180/pass-2/pair-trade-many-390.png) |
| page-2 | [pair](../../output/playwright/issue-180/pass-2/pair-customer-page-2-1440.png) | [pair](../../output/playwright/issue-180/pass-2/pair-customer-page-2-390.png) | [pair](../../output/playwright/issue-180/pass-2/pair-trade-page-2-1440.png) | [pair](../../output/playwright/issue-180/pass-2/pair-trade-page-2-390.png) |
| long | [pair](../../output/playwright/issue-180/pass-2/pair-customer-long-1440.png) | [pair](../../output/playwright/issue-180/pass-2/pair-customer-long-390.png) | [pair](../../output/playwright/issue-180/pass-2/pair-trade-long-1440.png) | [pair](../../output/playwright/issue-180/pass-2/pair-trade-long-390.png) |

[First pass](../../output/playwright/issue-180/pass-1/) · [Second pass](../../output/playwright/issue-180/pass-2/)

## Visible words

Counts include scrollable content, visible navigation/logo words, badges and modal text; exclude Material Symbols, invisible accessibility text and collapsed menus. User-authored job descriptions retain their full text. These are measurements, not copy targets.

| View | Customer 1440 | Customer 390 | Tradie 1440 | Tradie 390 |
|---|---:|---:|---:|---:|
| default | 51 | 44 | 51 | 44 |
| unread | 32 | 25 | 32 | 25 |
| read | 48 | 41 | 48 | 41 |
| empty | 15 | 8 | 15 | 8 |
| loading | 16 | 9 | 16 | 9 |
| error | 17 | 10 | 17 | 10 |
| offline | 53 | 46 | 53 | 46 |
| saving | 51 | 44 | 51 | 44 |
| expired | 58 | 51 | 58 | 51 |
| many | 266 | 259 | 266 | 259 |
| page-2 | 79 | 72 | 79 | 72 |
| long | 67 | 60 | 67 | 60 |

[Complete counted strings](../../output/playwright/issue-180/pass-2/word-counts.json).

## Verification

- `npm run lint`: passed, no warnings in the final run.
- `npm run typecheck`: passed.
- `npm test -- --maxWorkers=1`: 2,204 passed across 105 files, zero skipped. Node 22 and PostgreSQL 17 ran in the same disposable VM, with original test deadlines and every assertion intact.
- Affected Playwright: 29 passed, two production-only checks deferred to the standard production run. Includes every existing bell test and all new list/signed-in tests.
- Five widths (320/390/768/1024/1440), both modes and eight review states each: 80 page/axe combinations; no sideways scroll or axe violations. Existing bell coverage adds 40 state/width axe combinations. All/Unread arrows, visible keyboard focus, Next/Previous, retry, protected destination/Back, read-all persistence, offline and session loss also executed.
- Production build: passed. Standard production e2e: **188 passed, 439 opt-in skips**. Required notification opt-in coverage ran separately; the two production fixture guards passed here. [Sanitized check record](../../output/playwright/issue-180/checks.json).

Heavy checks ran serially under the owned atomic `/tmp/trade-marketplace-heavy-check.lock`, with owner/PID recorded, released on exit, at most two build workers and one test/browser worker. No other worker was terminated. The first full-unit container omitted `.git`, preventing the existing tracked-file seed suite from loading; restoring the actual checkout metadata resolved it and the full suite passed. Initial browser startup used an incompatible Node 22.17 module loader / absent default Chromium revision; Node 22.23.4 and the installed Chromium resolved those harness issues. No test, dependency or production guard was weakened.

No live Supabase/database, production credentials or money action was used. No merge or manual deployment was performed. Notification preferences PR397 and prior draft branches were untouched. William reviews code; Matt reviews the explicit desktop/reference interpretation and copy/screens.
