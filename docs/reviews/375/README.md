# #375 — keep navigation clear while scrolling

Matt's screenshot showed the homepage copy crossing the sticky logo and the van crossing its navigation links. Reproduced on merged main `a9e46d321d53f67333922f29d4a6a725ccf7c698`: at 1440px with scrollY 350, the header's M06 fill opacity was 0; at 390px with scrollY 150, it was also 0.

The public header now uses the hero's top edge as its scroll threshold. It stays transparent at rest and fills Forest as scrolling starts, using the existing M06 background/shadow layer and 200ms transition. The older bottom-edge observer remains the default for other consumers of `useScrolledPast`. Native section links stop below the sticky header. Product copy, logo, fonts, colours, header height and page layout are unchanged. The local shell's testing instruction and M06 references now describe the corrected timing.

## Visual review

Opened `docs/design/pages.html#w-landing` and `docs/design/screens.html` (`pub-landing`) in real Chromium at 1440/390 before implementation. Compared the built screens at both widths twice. Published images preserve the native viewport size on each side:

- `mockup-1440.png`, `mockup-390.png`: mockup beside the initial transparent state. Existing #211 founder-approved copy/layout exceptions are recorded in DECISIONS.md.
- `top-1440.png`, `top-390.png`: before/after at the top.
- `hero-scroll-1440.png`, `hero-scroll-390.png`: before/after the exact collision, at scrollY 350/150.
- `below-hero-1440.png`, `below-hero-390.png`: before/after beyond the hero.
- `no-hero-1440.png`, `no-hero-390.png`: before/after the solid plain-page shell.
- `menu-390.png`: before/after the open phone menu.

`counts.json` records unchanged word counts for every capture. Counts cover the full visible page, including placeholders and artwork; decorative Material Symbol ligatures, invisible labels, closed content and dev tooling are excluded. No copy-cut target was applied.

## Kit and token inventory

Reviewed existing Button/IconButton/TextLink; Field/TextFields/ChoiceFields/AddressField/TimeWindowPicker; JobTile/JobRow/CategoryTile/CategoryRail/ProfileCard/StatCards/EmptyCard; Pill/StatusPill/BountyPill/Tracker/PriceBlock; Banner/Menu/ModalShell/Dialog/Drawer/Sheet/Toast; EmptyState/ErrorState/Skeleton/LoadingRegion/LiveMessage/OfflineBanner/Progress; DataTable/FilterBar/QuickFilters/Tabs/Pagination; Avatar/Stars/PhotoGallery/PhotoViewer/PhotoPicker/DropZone/ProgressRing; MapSurface/MapboxSurface/MapListLayout/MapCard/MapPin; AuthLayout/SiteShell/AppShell/OfficeShell and their navigation.

This change reuses SiteHeader, Wordmark, Button/IconButton and the M06 hook/layer. Reviewed `src/styles/tokens.css`: existing Forest, text-on-dark, header shadow, spacing, sizing, z-index, Trade UI/Display axes and mode palettes. No new colour, font, spacing or animation tokens.

## Routes and verification

Public route: `/`. Native section-link check: `/#category-heading`. Local guarded fixture: `/dev/components/site-shell?hero=off`; its images are committed because dev fixtures deliberately return 404 on Vercel.

Browser checks cover 320/390/768/1024/1440 with normal and reduced motion, first-pixel scroll, wheel and keyboard scrolling, both scroll directions, restored positions after reload, direct section links, resizing, hero/plain route changes, the open/closed phone menu, 200% text and axe. The keyboard check waits for the browser's native PageDown scroll to finish before returning to the top.

No database/Supabase commands or schema changes. Category labels clipping at 200% text are a separate pre-existing finding recorded in #376; CategoryTile styling is not changed here.

Rebased on #374 after it merged, retaining its pointer-focus and coverage-banner fixes.
