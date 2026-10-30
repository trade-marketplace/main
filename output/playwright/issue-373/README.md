# Issue 373 — Menu typeahead

Scope: `src/components/overlays/Menu.tsx` label extraction and focused browser tests. No styling, positioning, copy, server values, credentials or database code changed.

Read the root AGENTS.md (the only AGENTS.md in this checkout), DECISIONS.md, WEBAPP_SPEC.md, relevant FRONTEND_SPEC sections, tokens.css, the app-shell component reference, existing overlay tests and issue/comments before implementation. This checkout has no `.agents/skills` directory. The newer delegated founder direction takes precedence over the older supporting-copy wording; this change adds no visible words.

## Component inventory

Existing kit: Button/IconButton/TextLink; forms (Field, TextFields, ChoiceFields, AddressField, TimeWindowPicker); cards (CategoryTile, EmptyCard, JobRow, JobTile, ProfileCard, StatCards); status (Pill, StatusPill, PriceBlock, Tracker, BountyPill); overlays (Menu, Dialog, Drawer, Sheet, Banner, Toast); feedback (EmptyState, ErrorState, LoadingRegion, Skeleton, Progress, LiveMessage, OfflineBanner); data (DataTable, FilterBar, Pagination, QuickFilters, Tabs); media (Avatar, DropZone, PhotoGallery, PhotoPicker, PhotoViewer, ProgressRing, Stars); map (MapSurface, MapboxSurface, MapCard, MapPin, MapListLayout); app/office/site/auth/account shells. Tokens live in `docs/design/tokens.css` and the existing source styles. Only the existing Menu is changed.

## Visual evidence

References were opened in real Chromium before code: `pages.html#w-notifs` at 1440×900 and `screens.html#sh-account` at 390×844. The phone reference is the nearest account screen; it is not a designed phone avatar dropdown. The reference website itself retains its catalogue navigation/frame and crops at phone width. Baseline/build comparisons establish the absence of a visual regression more directly than the mockup's different example page and dimensions.

Both final passes were personally inspected, side by side, with the matching reference and with the actual pre-change menu. Each pair keeps the two original equal-size viewport captures without resizing. The final capture waits for hydration, focus, fonts and M08 to settle. Earlier unsettled captures were replaced, without changing app code.

- `reference-desktop-before.png`, `reference-phone-before.png`: before-code reference captures.
- `before-1440.png`, `before-390.png`: before-code built menu baseline.
- `pass-{1,2}-{1440,390}.png`: unchanged default open menu.
- `mockup-pair-pass-{1,2}-{1440,390}.png`: reference left, final build right.
- `baseline-pair-pass-{1,2}-{1440,390}.png`: before left, final build right.
- `payments-focused-{1,2}-{1440,390}.png`: P focuses the actual Payments item, with M05 keyboard focus.
- `visual-measurements.json`: menu crop comparison and visible word counts.

The default menu crop has **zero changed pixels** in all four final baseline/build comparisons. Ten visible menu words at both widths: Sarah Thompson (2), email (1), Account (1), Payments (1), Notification settings (2), Help (1), Log out (2). Icon ligatures and invisible accessibility text are excluded. No page text is added or removed. The long explanatory copy belongs to the existing developer catalogue and is outside this issue.

This is a keyboard-behaviour fix. Loading/empty/error/offline data states are not added because Menu owns no data request. Existing arrows, Home/End, Escape, Tab, pointer dismissal and focus return remain covered. Typeahead matches nested decorative-icon content safely and honours explicit accessible labels, including `aria-labelledby` precedence. No positioning or contrast changes are included.

## Verification environment

Source: c322099, based on main faaf5d2587ae5dcb19492da628814e3848f29c57. Node 22.23.4; installed real Google Chrome via Playwright; task-only ports 3373 (dev), 3473 (production checks), 4373 (reference files), 55373 (disposable native PostgreSQL 17, UTC). App/build/browser live DB and Supabase variables empty. Full unit tests use only the throwaway localhost cluster. Heavy commands serialize under the atomic shared lock with an owner/PID record and at most two workers. The local build temporarily caps Next workers at two; that config change is restored and not committed.

`focused.log`: 7/7 passed, including all five widths, full-page axe and zero sideways scroll, multi-character matching, repeated-letter cycling, nested decorations and explicit accessible naming. The first harness attempt used an outside-click target obscured by the open menu; replacing it with the existing Read everything button resolved the harness failure without app changes.

No merge or manual deployment. Current public homepage verified HTTP 200. There is no new public screen: guarded developer fixtures remain unavailable on Vercel. GitHub denied reading the project-board item because the CLI token lacks read:project; the issue claim was posted successfully. No permission scopes changed.

Final gates: lint and typecheck passed; 104 unit files / 2,191 tests passed with zero skips; build passed; full production e2e 187 passed / 432 normal conditional skips / zero failures. All seven new cases ran separately with zero skips; six existing menu regressions also passed. All heavy gates completed and the owned lock was released. See checks.json and the command logs.
