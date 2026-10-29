# Homepage review #211

Built from w-landing and pub-landing, with Matt's 29 Oct copy and design direction recorded in DECISIONS.md. The explanatory step and promise paragraphs, category sublabels, review captions and fuller FAQ copy are retained. The three removed eyebrows, the first section's upward shift, the hero bolt's rightward shift and the fuller “Want to work? Easy as.” tradie pitch are intentional founder changes.

The price illustration uses Trade Display at 34px / weight 900 / wdth 151 / opsz 28, matching the reference. The hero is 92px on desktop and 44px on phones. Original van/category art and full-size design photos are used. Existing SiteHeader/SiteFooter behavior from #83 is retained, including their mobile menu and omission of unconfigured company/social details.

Matt approved the static $372.00 product illustration and design review examples for now. The illustration is decorative, with no payment handler. Example reviews are visibly labelled and automatically replaced when visible database reviews are available. The real-review query selects only first name, rating and review text, excludes hidden rows, and never forwards job, address or pay details.

The Post a Job and waitlist destinations remain separate issues, as Matt approved. Text, type and location survive in both a session draft and a bounded, encoded return URL. The current authentication redirect retains that URL. Other marketing links use their future destinations; the missing service collection/index is tracked in #370.

The editable IP hint follows [Vercel's documented request headers](https://vercel.com/docs/headers/request-headers#x-vercel-ip-city). Browser location is requested once; denied/unavailable permission leaves the editable hint. Place lookup uses the existing Mapbox provider and permanent results for possible saved-draft use; missing/refused tokens fall back to manual entry. Neither location hints nor hand-off parameters authorize posting.

## Screenshots and counts

Each desktop pair contains native 1440px captures. Each phone pair contains a native 390px comparison of the first viewport; the full phone scroll is linked separately because the phone mockup only designs the first screen. Reference browser/OS chrome is excluded. Dialog-state captures show the active viewport. Comparisons were inspected across two passes, including every common section and the conditional headers, coverage banner and location sheet.

Counts include visible text, decorative illustration text, avatar initials and empty placeholders; they exclude icon ligatures, hidden labels/headings, closed accordion answers and input values. Page states count the full scroll with the first FAQ answer open. Location states count the active dialog. These are recorded counts, not a word-reduction target.

| State | Desktop | Phone | Desktop pair | Phone pair | Full phone |
|---|---:|---:|---|---|---|
| signed-out | 389 | 348 | [Compare](signed-out-desktop.png) | [Compare](signed-out-phone.png) | [Full scroll](signed-out-phone-full.png) |
| signed-in | 388 | 346 | [Compare](signed-in-desktop.png) | [Compare](signed-in-phone.png) | [Full scroll](signed-in-phone-full.png) |
| outside | 392 | 351 | [Compare](outside-desktop.png) | [Compare](outside-phone.png) | [Full scroll](outside-phone-full.png) |
| reviews | 387 | 346 | [Compare](reviews-desktop.png) | [Compare](reviews-phone.png) | [Full scroll](reviews-phone-full.png) |
| location-loading | 7 | 7 | [Compare](location-loading-desktop.png) | [Compare](location-loading-phone.png) | [Full scroll](location-loading-phone-full.png) |
| location-error | 8 | 8 | [Compare](location-error-desktop.png) | [Compare](location-error-phone.png) | [Full scroll](location-error-phone-full.png) |

“reviews” is the server-review presentation simulated with synthetic local fixtures; it omits the example label. All fixtures are guarded and return 404 on Vercel.

## Validation

- lint, typecheck, 2,026 unit tests, build and the standard browser run passed.
- Standard browser run: 120 passed, 362 optional preview cases skipped.
- Affected landing/site-shell preview run: 70 passed, two production-only cases skipped.
- All five widths: 320 / 390 / 768 / 1024 / 1440; axe, overflow, primary actions, full copy, modal loading/error and header states.
- Enter/button/category/example/final-CTA hand-offs; storage denied; Unicode return-path bounds; outside-area routing; provider selection/manual fallback; one browser location request; keyboard FAQ.
- M06/M07 checked at 1440 and 390 with normal motion, then reduced motion; 3s illustration float and exact Display price font checked. Existing 200% shell-text checks passed.
- Disposable local PostgreSQL only. No Supabase commands and no schema/migration changes.

Selected kit: SiteShell, SiteHeader, SiteFooter, BoltMark, Button, TextField, AddressField, CategoryTile/CategoryRail, Pill, Avatar, StarRating, Banner and Dialog. Shared extensions are optional visually hidden field labels, a stars-only rating variant and the A01 illustration float registered under M06. Existing defaults remain unchanged. William should review the public place action exception and server data selection; Matt should review the pairs.

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
