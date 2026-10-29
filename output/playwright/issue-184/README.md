# Issue #184 evidence

Isolated checkout: `/Users/matthewlarsen/Documents/Codex/2026-10-30/task-2/waitlist`.
Branch: `feat/184-area-waitlist`. Current base: `faaf5d2587ae5dcb19492da628814e3848f29c57`.

Post-rebase verification is queued behind the shared heavy-check lock. The existing logs and first three visual passes below were captured on the earlier `3c7344f8dc5e6cce7ed2779af0599191a9302f3d` base. They are historical evidence, not a claim that the new upstream recovery/auth changes have already been reverified. The final verification report will identify its actual base and source commit.

## References captured before implementation

- [1440px desktop, w-waitlist](mockup-1440-before.png), opened in real Chromium from `docs/design/pages.html#w-waitlist`.
- [390px nearest phone form](phone-nearest-390-before.png), opened in real Chromium from `docs/design/screens.html#pub-login`.
- There is no waitlist phone screen in `screens.html`. Its existing 36px form insets, 36px heading and full-width action inform the phone arrangement. Only the catalog navigation was hidden for that capture.
- The desktop reference includes its original 40px browser decoration. Built captures show the app viewport, without browser decoration.

## Inventory and implementation choices

Read the full root AGENTS.md, DECISIONS.md, WEBAPP_SPEC.md, applicable FRONTEND_SPEC.md sections, testing and PR-gate documentation. There is no `.agents` directory or nested AGENTS.md in this checkout.

Inventoried `src/components`: Button/TextLink/Icon; forms; cards; status/price/tracker; overlays/banner/toast; feedback/offline/skeleton; data; media; map; site/app/office shells. Read `src/styles/tokens.css` and the named motion classes.

Reused SiteShell, the existing van asset, TextField, Button, Banner, ToastProvider/useToast, and useOnlineStatus. The page module arranges those existing controls using token values and the mockup's form geometry. It adds no fonts, palette, illustrations, icon system or animations. Page and success entrances use M01; copy uses the existing M14 toast.

The latest delegated user copy rule overrides the older repository copy guidance: explanatory paragraphs, hints, the live-area caption and the success prompt were removed. The required suburb field remains editable. Coverage still comes from `loadCoverage()` and is available in the region's accessible name, with no invented area list.

Wellington is the built example because it is outside the configured coverage. The mockup's Gore example is inside the current 60 km Invercargill coverage. No production success is simulated: preview states exist only behind `guardDevPage()`. Public `?state=joined` has no effect.

The new waitlist migration is review-only, for William. It was applied only in task-specific throwaway local test facilities. It was never applied to live Supabase.

## Visual passes

Pass 1: personally inspected all six states at 1440 and 390 against the desktop reference and nearest phone form. Corrected the field geometry (55px height, existing 11px radius token), heading/form spacing, desktop action width/gap, and compact success-banner spacing while retaining the 44px copy target.

Pass 2: personally inspected all six states again at both widths. It exposed a CSS-specificity override that still made the field corners square. Corrected only the waitlist selector so the existing 11px action-radius token wins.

Pass 3: personally inspected all six states at both widths again. Final images and measurements are under `pass-3/`. Every capture has zero sideways overflow, zero axe violations, a 55px email field and 11px field corners. `measurements.json` records main-content visible word counts, heading/form geometry, field radius/height and axe results for every state and width. Counts include field values/placeholders; they exclude hidden labels, icon ligatures and shared shell text. `word-counts.md` also gives complete viewport totals including the unchanged header.

`capture.mjs` reproduces the images and measurements against the task's guarded built preview at `http://127.0.0.1:4284`.

## Test isolation

- App/e2e production port: 3184, live database and Supabase settings blank.
- Guarded preview port: 4284, task-only local Postgres at 127.0.0.1:54336.
- Static reference port: 4184.
- Unit DB: throwaway native Postgres at 127.0.0.1:54884, UTC, one schema per test file through the existing test helper.
- Runtime used for final verification: official Node 22.23.4, checksum-verified and extracted under `/tmp`; no project dependencies or configured host runtime changed.

Earlier attempt logs are retained. The Docker run exposed pre-existing timestamp sensitivity to its clock offset; native Postgres initially exposed its Auckland timezone. Both were resolved in the isolated test environment, without changing any existing assertions. The old Node 22.17 runtime also crashed in full e2e module loading; a supported Node 22 patch was used for the final run.

## Access limit

GitHub rejected reading the issue's project item because the CLI token lacks `read:project`; moving its board card was therefore unavailable. The issue claim and access limit were posted on #184. Repository push and draft-PR access are available. No account scopes or access settings were changed.

## Verification and optional catalog findings

All 103 unit files passed: 2,151 tests, zero skipped, using the UTC native test database. After the final CSS-only adjustment, the focused token/icon/public-action/waitlist unit checks also passed: 20 tests, zero skipped. Final lint, typecheck and production build passed. Standard production e2e: 188 passed, 422 existing conditional skips, zero failures. Waitlist e2e with the guarded fixture explicitly enabled: 17 passed, zero skipped. Final production checks and every waitlist fixture case are recorded in `verification.json` and the `*-verified.log` files. The standard production e2e configuration intentionally skips development-fixture cases; the separate waitlist run enables its guarded preview, so required waitlist coverage is not skipped.

An extra expanded component-catalog run enabled development fixtures globally. It exposed unrelated existing failures: cards redirect expectation ([#361](https://github.com/trade-marketplace/main/issues/361)); two feedback selectors ([#393](https://github.com/trade-marketplace/main/issues/393)); trade-menu contrast during the overlay check ([#394](https://github.com/trade-marketplace/main/issues/394)). No affected component, assertion, skip condition or auth rule was changed. That extra run was stopped with 279 passed, 4 failed, 2 interrupted, 20 skipped and 305 not run; it is not represented as green. Its log, contexts, screenshots and traces remain in `optional-catalog.log` and `optional-failures/`.
