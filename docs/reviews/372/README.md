# #372 — pointer focus and the coverage banner

Before: merged main `a9e46d321d53f67333922f29d4a6a725ccf7c698`. After: this branch.

Matt's [Vercel feedback](https://vercel.com/trade-marketplace/main/c/gFKRdfdfCUVj?s=15) identifies the outside-area banner's alignment/wrapping. The related chat requests invisible focus outlines after clicking buttons or text fields. Pointer focus now suppresses the shared ring, including focus moved by an example chip, menu or dialog. Keyboard navigation restores M05; typing and caret movement after a click keep the ring hidden. The normal field border, error border and selected states remain visible. No JavaScript retains the existing focus styling.

The banner uses the existing kit layout, type and colours. Its title/action form a wrapping row aligned with the icon; the action keeps a 44px target and its words stay together. No product copy changed. The homepage's approved fuller copy remains.

## Visual review

Opened `docs/design/pages.html#w-landing` and `docs/design/screens.html` (`pub-landing`) in Chromium at 1440 and 390. Mockup comparisons are `mockup-1440.png` and `mockup-390.png`. Existing founder-approved differences from those older mockups remain recorded in DECISIONS.md (#211).

Captured and inspected before/after pairs twice at both widths for the outside banner, homepage example-chip focus, login, signup choice, customer details, tradie details, form fields, app shell and office shell. Each published pair keeps both captures at their native viewport size. The only intended differences are focus styling and the banner's alignment/wrapping. The two shell examples show opening and closing Account by pointer. Menu/overlay keyboard and pointer behaviour is also checked in the browser tests.

Word counts are in `counts.json`: the complete visible page, including placeholders and decorative price artwork; excluding Material Symbol ligatures, invisible labels, closed accordion content and development tooling. Counts are identical before/after at each width. These are review counts, not a copy-cut target.

## Existing kit and tokens reviewed

- Buttons: Button, IconButton, TextLink.
- Fields: Field, TextFields, ChoiceFields, AddressField, TimeWindowPicker.
- Cards/status: JobTile, JobRow, CategoryTile/CategoryRail, ProfileCard, StatCards, EmptyCard; Pill, StatusPill, BountyPill, Tracker, PriceBlock.
- Overlays/feedback: Banner, Menu, ModalShell, Dialog, Drawer, Sheet, Toast; EmptyState, ErrorState, Skeleton, LoadingRegion, LiveMessage, OfflineBanner, Progress.
- Data/media: DataTable, FilterBar, QuickFilters, Tabs, Pagination; Avatar, Stars, PhotoGallery, PhotoViewer, PhotoPicker, DropZone, ProgressRing.
- Map/shells: MapSurface, MapboxSurface, MapListLayout, MapCard, MapPin; AuthLayout, SiteShell, AppShell/View, OfficeShell/View and their navigation.
- `src/styles/tokens.css`: existing Trade UI/Display axes, focus colour, mode palettes, spacing, sizing, shape and elevation tokens. No colour or font tokens added. `--trade-focus-ring` is an input-method override; each kit style falls back to its original outline when the override is absent.

## Routes and states

Public: `/`, `/login`, `/signup`, `/signup/customer`, `/signup/tradie`.

Local guarded fixtures: `/dev/components/landing?state=outside`, `/dev/components/landing?state=signed-out`, `/dev/components/fields`, `/dev/components/app-shell`, `/dev/components/office-shell`. Existing fixture suites also cover error/loading/empty/success, disabled and long-content states. These fixtures deliberately return 404 on Vercel; their images are committed here.

## Verification

Responsive checks at 320/390/768/1024/1440. New regression tests cover mouse/touch focus, typing/caret movement, Tab/Shift+Tab, buttons, example chips, dialog restoration, menu arrows/typeahead, address suggestions and the no-JavaScript fallback. No live Supabase operations or schema changes.

Known separate findings: #346 (optional local-database timestamp assertion), #361 (optional cards preview expects an authenticated URL/fragment while signed out), #373 (menu typeahead includes decorative icon ligatures). The full optional fixture run also hit a waitlist-navigation timing failure during concurrent compilation; that hand-off passed on the subsequent focused run. None of these paths is altered by this fix.
