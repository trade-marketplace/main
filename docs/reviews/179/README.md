# Notification bell review #179

The dropdown uses the existing kit Menu, IconButton, Skeleton, NavCount, SessionExpiredProvider and app shell. The panel is 400px on desktop, with the mockup's 36px icon tiles, 64px rows, type and tokens. The footer keeps the kit's 44px minimum tap target (4px taller than the static mockup). On phones E02 uses the closest customer app header; the separate full-page E03 inbox belongs to #180.

Each comparison contains native 1440px desktop and 390px phone captures, plus native panel crops. The reference is w-notifs. Empty, loading and error variants follow the same designed panel because no separate mockups exist. The development fixtures use synthetic data and return 404 on Vercel. Captures were inspected and corrected across two passes; all five widths passed axe and overflow checks.

Word counts cover the visible notification panel, excluding icon ligatures, invisible accessibility announcements and the surrounding app shell. Fixture user-written text is counted in full, including text that visually ends in an ellipsis. Empty body: two words. Counts are equal at both widths.

| State | Words (1440 / 390) | Comparison |
|---|---:|---|
| unread | 35 / 35 | [Mockup / built](pair-unread.png) |
| read | 32 / 32 | [Mockup / built](pair-read.png) |
| empty | 6 / 6 | [Mockup / built](pair-empty.png) |
| loading | 7 / 7 | [Mockup / built](pair-loading.png) |
| error | 9 / 9 | [Mockup / built](pair-error.png) |
| many | 63 / 63 | [Mockup / built](pair-many.png) |
| long | 48 / 48 | [Mockup / built](pair-long.png) |
| saving | 35 / 35 | [Mockup / built](pair-saving.png) |

Checks: lint, typecheck, 2,038 unit tests (disposable local PostgreSQL), build, 109 standard browser cases, and 60 affected preview browser cases passed. Optional production/preview-only cases were skipped by their respective runners. Browser checks cover all eight states at 320 / 390 / 768 / 1024 / 1440, keyboard focus and recovery, row destinations after confirmed reads, latest eight/full unread count, M08/M20, session expiry, tradie mode, and existing menu/app-shell regressions. No schema or migration changes; no Supabase commands were run. William should review authenticated reads/writes; any future schema changes require William's review.

## Existing component inventory

- **Brand, buttons and links:** BoltMark, Button, Icon, TextLink, Wordmark.
- **forms:** AddressField, ChoiceFields, Field, TextFields, TimeWindowPicker.
- **cards:** CategoryTile, EmptyCard, JobRow, JobTile, ProfileCard, StatCards.
- **status:** BountyPill, Pill, PriceBlock, StatusPill, Tracker.
- **overlays:** Banner, Dialog, Drawer, Menu, ModalShell, Sheet, Toast.
- **feedback:** EmptyState, ErrorState, LiveMessage, LoadingRegion, OfflineBanner, Progress, Skeleton.
- **data:** DataTable, FilterBar, Pagination, QuickFilters, Tabs.
- **media:** Avatar, DropZone, PhotoGallery, PhotoPicker, PhotoViewer, ProgressRing, Stars.
- **map:** MapCard, MapListLayout, MapPin, MapSurface, MapboxSurface.
- **site:** SiteFooter, SiteHeader, SiteShell.
- **app:** AppNav, AppShell, AppShellView.
- **office:** OfficeNav, OfficeShell, OfficeShellView.
- **auth:** AuthLayout, CustomerSignup, LoginForm, SessionExpired, SignupChoice, WorkerSignupFields.
- **motion:** BoltFlash, CountUp.

## Existing tokens

No token or CSS file changes. Components keep Trade Display / Trade UI and Material Symbols Rounded.

`--trade-forest` `--trade-forest-2` `--trade-paper` `--trade-mint` `--trade-surface` `--trade-ink` `--trade-leaf` `--trade-lime` `--trade-hivis` `--trade-amber` `--trade-gold` `--trade-on-gold` `--trade-cat-electrical` `--trade-cat-plumbing` `--trade-cat-construction` `--trade-cat-gas` `--trade-cat-gas-ink` `--trade-cat-other` `--trade-text` `--trade-text-2` `--trade-text-3` `--trade-text-on-dark` `--trade-text-on-dark-2` `--trade-source-muted` `--trade-line` `--trade-line-strong` `--trade-field-border` `--trade-chip-bg` `--trade-chip-line` `--trade-focus` `--trade-danger` `--trade-danger-bg` `--trade-success` `--trade-success-bg` `--trade-waiting` `--trade-waiting-bg` `--trade-info` `--trade-info-bg` `--trade-action` `--trade-on-action` `--trade-signature` `--trade-on-signature` `--trade-link` `--trade-tint` `--trade-tint-strong` `--trade-font-heading` `--trade-font-body` `--trade-display-axes` `--trade-ui-axes` `--trade-fs-display` `--trade-lh-display` `--trade-fs-title` `--trade-lh-title` `--trade-fs-price` `--trade-lh-price` `--trade-fs-heading` `--trade-lh-heading` `--trade-fs-subheading` `--trade-lh-subheading` `--trade-fs-section` `--trade-lh-section` `--trade-fs-label` `--trade-lh-label` `--trade-fs-body` `--trade-lh-body` `--trade-fs-small` `--trade-lh-small` `--trade-fs-button` `--trade-lh-button` `--trade-fs-caption` `--trade-lh-caption` `--trade-space-1` `--trade-space-2` `--trade-space-3` `--trade-space-4` `--trade-space-5` `--trade-space-6` `--trade-space-8` `--trade-space-9` `--trade-space-10` `--trade-space-12` `--trade-space-16` `--trade-space-20` `--trade-inset-browse` `--trade-inset-form` `--trade-gap-tile` `--trade-gap-photo` `--trade-radius-job-tile` `--trade-radius-action` `--trade-radius-category` `--trade-radius-card` `--trade-radius-sheet` `--trade-radius-field` `--trade-radius-pill` `--trade-shadow-category` `--trade-shadow-action` `--trade-shadow-header` `--trade-shadow-sheet` `--trade-shadow-pop` `--trade-tap` `--trade-btn-h` `--trade-btn-h-hero` `--trade-btn-h-small` `--trade-field-h` `--trade-nav-height` `--trade-header-h` `--trade-content-width` `--trade-content-max` `--trade-read-max` `--trade-z-sticky` `--trade-z-nav` `--trade-z-sheet` `--trade-z-modal` `--trade-z-toast` `--trade-dur-fast` `--trade-dur-base` `--trade-dur-slow` `--trade-ease-out` `--trade-ease-in-out`
