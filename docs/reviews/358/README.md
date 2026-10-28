# Copy review #358

Counts include visible text and empty-input placeholders. They exclude icon ligatures, hidden accessibility text and input values. Shared-component counts cover the production components, excluding the surrounding development documentation. Session-dialog counts cover the dialog. Fixture job titles and data remain. Before captures use main 63a0896, including #365 and #367. Images contain native 1440px and 390px captures side by side; click to inspect at full resolution.

| Screen / state | Route | 1440 before → after | 390 before → after | Before / after |
|---|---|---:|---:|---|
| home | `/` | 72 → 53 | 64 → 45 | [Comparison](home.png) |
| login | `/login` | 38 → 21 | 18 → 17 | [Comparison](login.png) |
| login-wrong | `/dev/components/login?state=wrong` | 48 → 24 | 28 → 20 | [Comparison](login-wrong.png) |
| login-locked | `/dev/components/login?state=locked` | 48 → 23 | 28 → 19 | [Comparison](login-locked.png) |
| login-unverified | `/dev/components/login?state=unverified` | 50 → 23 | 30 → 19 | [Comparison](login-unverified.png) |
| login-invalid | `/dev/components/login?state=invalid` | 49 → 27 | 29 → 23 | [Comparison](login-invalid.png) |
| login-unavailable | `/dev/components/login?state=unavailable` | 49 → 22 | 29 → 18 | [Comparison](login-unavailable.png) |
| signup-choose | `/signup` | 47 → 20 | 32 → 16 | [Comparison](signup-choose.png) |
| signup-choose-tradie | `/signup?as=tradie` | 47 → 20 | 32 → 16 | [Comparison](signup-choose-tradie.png) |
| signup-customer | `/signup/customer` | 74 → 32 | 43 → 20 | [Comparison](signup-customer.png) |
| customer-email-taken | `/dev/components/signup-customer?state=email-taken` | 83 → 34 | 52 → 22 | [Comparison](customer-email-taken.png) |
| customer-weak-password | `/dev/components/signup-customer?state=weak-password` | 83 → 32 | 52 → 20 | [Comparison](customer-weak-password.png) |
| customer-invalid | `/dev/components/signup-customer?state=invalid` | 106 → 46 | 75 → 34 | [Comparison](customer-invalid.png) |
| customer-unavailable | `/dev/components/signup-customer?state=unavailable` | 84 → 32 | 53 → 20 | [Comparison](customer-unavailable.png) |
| customer-try-later | `/dev/components/signup-customer?state=try-later` | 83 → 31 | 52 → 19 | [Comparison](customer-try-later.png) |
| customer-success | `/dev/components/signup-customer?state=success` | 51 → 19 | 34 → 13 | [Comparison](customer-success.png) |
| customer-loading | `/dev/components/signup-customer?state=loading` | 74 → 32 | 43 → 20 | [Comparison](customer-loading.png) |
| customer-offline | `/dev/components/signup-customer?state=offline` | 89 → 33 | 58 → 21 | [Comparison](customer-offline.png) |
| customer-draft | `/dev/components/signup-customer?state=draft` | 89 → 32 | 58 → 20 | [Comparison](customer-draft.png) |
| signup-tradie-account | `/signup/tradie` | 63 → 29 | 31 → 13 | [Comparison](signup-tradie-account.png) |
| tradie-default | `/dev/components/signup-tradie?state=default` | 102 → 46 | 86 → 38 | [Comparison](tradie-default.png) |
| tradie-licence-error | `/dev/components/signup-tradie?state=licence-error` | 124 → 55 | 108 → 47 | [Comparison](tradie-licence-error.png) |
| tradie-other | `/dev/components/signup-tradie?state=other` | 125 → 46 | 109 → 38 | [Comparison](tradie-other.png) |
| tradie-all-trades | `/dev/components/signup-tradie?state=all-trades` | 128 → 57 | 112 → 49 | [Comparison](tradie-all-trades.png) |
| tradie-email-taken | `/dev/components/signup-tradie?state=email-taken` | 72 → 31 | 40 → 15 | [Comparison](tradie-email-taken.png) |
| tradie-invalid | `/dev/components/signup-tradie?state=invalid` | 111 → 52 | 95 → 44 | [Comparison](tradie-invalid.png) |
| tradie-unavailable | `/dev/components/signup-tradie?state=unavailable` | 122 → 54 | 106 → 46 | [Comparison](tradie-unavailable.png) |
| tradie-try-later | `/dev/components/signup-tradie?state=try-later` | 121 → 53 | 105 → 45 | [Comparison](tradie-try-later.png) |
| tradie-loading | `/dev/components/signup-tradie?state=loading` | 105 → 47 | 89 → 39 | [Comparison](tradie-loading.png) |
| tradie-offline | `/dev/components/signup-tradie?state=offline` | 117 → 47 | 101 → 39 | [Comparison](tradie-offline.png) |
| tradie-success | `/dev/components/signup-tradie?state=success` | 56 → 23 | 34 → 13 | [Comparison](tradie-success.png) |
| tradie-area-loading | `/dev/components/signup-tradie?state=area-loading` | 105 → 47 | 89 → 39 | [Comparison](tradie-area-loading.png) |
| tradie-area-unavailable | `/dev/components/signup-tradie?state=area-unavailable` | 113 → 49 | 97 → 41 | [Comparison](tradie-area-unavailable.png) |
| session-notice | `/dev/components/session-expired?open=notice` | 7 → 4 | 7 → 4 | [Comparison](session-notice.png) |
| session-form | `/dev/components/session-expired?open=form` | 22 → 12 | 22 → 12 | [Comparison](session-form.png) |
| session-wrong | `/dev/components/session-expired?state=wrong` | 30 → 16 | 30 → 16 | [Comparison](session-wrong.png) |
| session-locked | `/dev/components/session-expired?state=locked` | 32 → 15 | 32 → 15 | [Comparison](session-locked.png) |
| session-unverified | `/dev/components/session-expired?state=unverified` | 35 → 15 | 35 → 15 | [Comparison](session-unverified.png) |
| session-invalid | `/dev/components/session-expired?state=invalid` | 25 → 15 | 25 → 15 | [Comparison](session-invalid.png) |
| session-unavailable | `/dev/components/session-expired?state=unavailable` | 34 → 14 | 34 → 14 | [Comparison](session-unavailable.png) |
| session-other-account | `/dev/components/session-expired?open=form&email=off` | 10 → 6 | 10 → 6 | [Comparison](session-other-account.png) |
| not-found | `/this-page-is-missing` | 65 → 54 | 57 → 46 | [Comparison](not-found.png) |
| server-error | `/dev/components/error-pages?page=500` | 85 → 55 | 77 → 47 | [Comparison](server-error.png) |
| server-error-no-ref | `/dev/components/error-pages?page=500&ref=off` | 80 → 53 | 72 → 45 | [Comparison](server-error-no-ref.png) |
| site-shell | `/dev/components/site-shell` | 55 → 44 | 47 → 36 | [Comparison](site-shell.png) |
| app-shell-customer | `/dev/components/app-shell` | 16 → 12 | 7 → 3 | [Comparison](app-shell-customer.png) |
| app-shell-tradie | `/dev/components/app-shell?viewer=tradie` | 16 → 12 | 7 → 3 | [Comparison](app-shell-tradie.png) |
| app-shell-account | `/dev/components/app-shell?menu=open` | 29 → 25 | 7 → 3 | [Comparison](app-shell-account.png) |
| office-shell | `/dev/components/office-shell` | 23 → 18 | 8 → 4 | [Comparison](office-shell.png) |
| office-shell-account | `/dev/components/office-shell?account=open` | 31 → 26 | 16 → 12 | [Comparison](office-shell-account.png) |
| fields-default | `/dev/components/fields?state=default` | 390 → 278 | 390 → 278 | [Comparison](fields-default.png) |
| fields-error | `/dev/components/fields?state=error` | 510 → 398 | 510 → 398 | [Comparison](fields-error.png) |
| fields-success | `/dev/components/fields?state=success` | 430 → 278 | 430 → 278 | [Comparison](fields-success.png) |
| fields-disabled | `/dev/components/fields?state=disabled` | 390 → 278 | 390 → 278 | [Comparison](fields-disabled.png) |
| map-missing-token | `/dev/components/mapbox?state=missing-token` | 201 → 171 | 201 → 171 | [Comparison](map-missing-token.png) |
| map-error | `/dev/components/mapbox?state=error` | 201 → 171 | 201 → 171 | [Comparison](map-error.png) |
| map-empty | `/dev/components/mapbox?state=empty` | 68 → 28 | 68 → 28 | [Comparison](map-empty.png) |
| map-location-denied | `/dev/components/mapbox?state=location-denied` | 214 → 189 | 210 → 185 | [Comparison](map-location-denied.png) |
| media | `/dev/components/media` | 66 → 15 | 66 → 15 | [Comparison](media.png) |
| feedback | `/dev/components/feedback?state=error` | 317 → 177 | 317 → 177 | [Comparison](feedback.png) |
| data | `/dev/components/data?open=saved-filters` | 13 → 8 | 13 → 8 | [Comparison](data.png) |
| data-save | `/dev/components/data?status=price&trade=Other&open=saved-filters` | 20 → 6 | 20 → 6 | [Comparison](data-save.png) |
| buttons | `/dev/components/buttons` | 182 → 182 | 182 → 182 | [Comparison](buttons.png) |
| cards | `/dev/components/cards` | 165 → 126 | 165 → 126 | [Comparison](cards.png) |
| status | `/dev/components/status` | 311 → 311 | 311 → 311 | [Comparison](status.png) |
| overlays | `/dev/components/overlays` | 96 → 41 | 96 → 41 | [Comparison](overlays.png) |

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
