# Help centre (#185)

**Final handoff:** [local-final/README.md](local-final/README.md) records verification on source `bd7c20d09fb0f04cc912fdb94d20e7115b562121`, the complete final browser suite, two visual passes, and cleanup. It supersedes historical checks and captures described below.

The original desktop reference is `docs/design/pages.html#w-help`; phone is `docs/design/screens.html#sh-support`. Captured in installed Chromium before implementation. `mockup-*.png` preserves the original browser/OS chrome; `reference-*.png` removes only its top 40px/44px, giving equally sized web-content panels (1440×960 and 390×800). Pair images show reference left, implementation right.

There is no drawn desktop Help home or phone article: those comparisons use the closest Help reference. Desktop's reference accidentally applies the catalogue's global `aside` styles to its support rail; the implementation keeps the Forest rail and card geometry, with readable Lime related links and shared-kit colours. Example timestamp/read time are replaced with Markdown metadata and a computed reading duration. Phone does not reproduce the OS status bar/home indicator. Public footer remains available below the screen.

Article source is repo-owned Markdown. The exact designed payment explanation is retained; other articles derive from existing approved copy, the page inventory and current decisions. Matt reviews copy/screens. Feedback requires a server-only table/migration reviewed by William; no live database migration is performed. A random http-only browser cookie is hashed for deduplication. No IP, name or public feedback counts are stored/exposed.

“Message us” uses the approved `hello@trademarketplace.nz` email until the separate support-thread screen (#186) is built. It works signed out. This PR does not claim to build that inbox.

Reviewer states: `/help?state=search-results`, `no-results`, `loading`, `error`; `/help/when-do-i-pay?state=helpful-voted`, `not-helpful`, `feedback-error`. These are explicit visual previews, not persisted votes. Real Yes/No submissions go through the server action and only display saved success after a database acknowledgement.

The GitHub issue claim succeeded. Project status read failed because the token lacks `read:project`; no token scopes were changed. The claim and board limitation are recorded on the issue.

Kit inventory: reused SiteShell/SiteHeader/SiteFooter, FocusVisibility, BoltMark, Button/TextLink/Icon, TextField, QuickFilters, EmptyState/ErrorState/InlineError, LoadingRegion/Skeleton/SkeletonText/LiveMessage and named M08/M24 styles. Existing cards, status, overlays, media, map, app and office shells were inspected; this informational page needs no job/status/map UI. New page composition uses the existing card shape/shadow tokens. No token/font/library changes.

Initial full verification found the public feedback action missing from the explicit action inventory (2,214 passed, one failed); its named allowlist entry documents the signed-out action's limited input. The subsequent full run passed all 2,215 tests. Earlier engine failure used the Mac's default Node 25; verification uses the repository-required Homebrew Node 22.22.0. No dependency versions changed.


Visual review corrected the decorative bolt overflow, the phone placeholder/chips, native Escape clearing the search query, the support rail and card spacing, and desktop error-grid stretching. The grid alignment correction is scoped to desktop so the phone loading skeleton keeps its full width. The initial full browser attempt found the success-state text locator included an icon ligature, and the automatic streaming loading boundary turned unknown articles into HTTP 200; the status locator now uses semantics and missing articles return HTTP 404 with one public shell. See [Next.js status-code guidance](https://nextjs.org/docs/app/api-reference/file-conventions/loading#status-codes). The explicit loading review state remains reachable.

The final deliverable retains complete first and final comparison sets. Superseded partial/incorrectly scrolled capture attempts are omitted; their helper failure is recorded in `capture-pass-3.txt`. Text counts measure rendered scrollable text, including footer/navigation; icon glyphs and the SVG logo are excluded. They are measurements, not copy-cutting targets. Phone includes a scrollable Tradies chip required by the topic inventory, in addition to the four reference chips.
