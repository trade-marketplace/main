# Notification preferences · #114

Route: `/profile/notifications`. Branch: `feat/114-notification-preferences`.

## Behaviour and boundaries

The checked viewer owns every database read and write. Customer and tradie catalogues are separate; new accounts receive server-owned defaults. The existing `NotificationPreference` model is unchanged. Invalid events, identity fields, unsupported roles/channels and locked cells are rejected before writing.

Changes save immediately as absolute values. One request runs at a time; pending changes to the same cell collapse to the latest choice. Late responses cannot overwrite newer choices. A confirmed save offers the shared M14 Undo toast; Undo persists the original confirmed value. A failed save rolls back and retains the attempted value for Retry. Lost-response retries are idempotent. Offline pauses writes and removes stale Undo; session loss rolls back and offers login with the original return path.

Extra-work approval channels stay on; receipts stay email-only. Mandatory choices are dimmed, disabled and explained through `aria-describedby`. Notification screens add no helper text, captions, hints or redundant save notices. SMS is absent under DECISIONS §63. The unsupported marketing row is omitted. Production values come from the server; fixtures are restricted to guarded development pages.

No schema, auth/session behaviour, account-security operation, live Supabase/database connection, provider activation or financial action was changed. In-app delivery is unchanged; email and push providers remain inactive.

## Reuse and shared layout

Read the complete `AGENTS.md`, `DECISIONS.md`, `WEBAPP_SPEC.md`, relevant frontend/testing/service guidance, issue and dependency comments. This checkout has no `.agents/` directory or nested `AGENTS.md`. Inventoried all component categories and `src/styles/tokens.css` before coding.

Reused `AccountSettings`, `AppShellView`, `DataTable` and its checkbox styles, `Icon`, shared loading/empty/error/offline/live feedback and `ToastProvider`. The account navigation now accepts an active route, with Security retained as the default. No new tokens, fonts, icon sets or notification-specific CSS were added.

The parent explicitly authorized a minimal reusable account-kit correction. The existing desktop content was 40px left of the reference and the short-screen background stopped early. `account.module.css` now supplies the reference content inset and 32px desktop title, fills the remaining shell, and mixes existing Forest/surface palette tokens for the reference background. Phone inset and type remain unchanged. Security content and behaviour are preserved. Before/after regression captures cover both modes at both required widths; automated geometry, control, overflow and axe checks cover both account routes at all five widths.

## Visual review

Actual Chromium mockups were captured and studied before feature code: `pages.html#w-account` at 1440×900 and `screens.html#sh-account` at 390×844. The original phone gallery capture is preserved as `mockup-before-390.png`; `mockup-390.png` hides only the gallery table of contents.

There is no designed phone notification matrix or separate tradie/state design. Each pair therefore uses the closest supplied account reference, with the existing responsive table kit for phone cards. The real shell has a 36px test-mode banner where the desktop reference has 40px of browser chrome; its existing search and navigation differences are outside this issue. Fewer rows/columns and shorter rows result from the founder’s copy rule, no SMS and no unsupported marketing. This is not a pixel-identical claim for undesigned states.

Pass 1 inspected structure and kit reuse (`pass1-*`). Pass 2 corrected checkbox density and muted locked ticks (`pass2-*`). The final pass reviewed all 36 notification pairs, 28 existing Security state pairs and four before/after Security pairs after the authorized kit correction. All 68 pairs were personally inspected. Raw viewport and `*-full.png` captures preserve below-fold content. Pair generation preserves source pixels at equal dimensions without stretching; only full-page baselines are clipped to the matching viewport.

## Required verification

After rebasing onto `faaf5d2`, lint and typecheck passed; the full unit/database suite passed **2,214 tests in 105 files, zero skipped**; the standard e2e command (including build) passed **204 tests, 429 existing opt-in skips**. The directly affected Security suite passed **13 tests, zero skipped**. The dedicated preference suite has 19 unit/database cases and 12 browser cases; five shared-layout regression tests are included in the standard e2e result.

Four real signed-in browser journeys passed using the actual login UI, Supabase SDK, cookies, role guard, server actions and disposable Postgres: customer save/reload/Undo, account-menu/Security/back navigation, phone tradie persistence and session-loss refusal/login return. Their server, identity and database logic is unchanged by the later client/kit corrections; fresh full unit, preference UI and Security regression checks cover those corrections.

The 429 standard skips are existing opt-in component/integration suites without their environment flags; they are not substitutes for this issue’s coverage. Notification previews, shared account regression and the four signed-in journeys were explicitly enabled in their respective runs. Keyboard operation, visible focus, pointer focus behaviour and axe were checked without disabling axe rules at 320/390/768/1024/1440.

Earlier Mac-host Node and Docker Postgres clock differences caused unchanged timestamp assertions to fail by 6–7ms; a busy-Mac tracked-file scan also exceeded its default deadline (#392, related historical #380/#346). The complete unit/database suite then passed with Node 22.23.4 and Postgres 17 in the same isolated Docker VM, with all assertions and default deadlines unchanged. No repository dependency or unrelated test assertion was changed.

Main advanced during final review. The branch was rebased cleanly onto `faaf5d2`, and all standard gates passed again on source commit `3988df64fe32a46c5a9925e84d8b4816a27b18bf`. Later changes are documentation/evidence only. The screenshot source routes and shared layout are byte-identical across the rebase, so their reviewed evidence remains valid. The reused signed-in and Security results retain the narrower coverage described above.

The first post-rebase unit attempt encountered a stale Vitest import-glob cache in this task’s reused Linux dependency volume. Clearing that private cache restored automatic inclusion of the upstream Recovery preview, without editing tests. The local orchestration wrapper later returned 127 from an invalid trailing path after the build/e2e command had passed; cleanup restored the temporary build configuration and released the lock. Each required gate itself returned zero. Exact totals, skip breakdown and source tree identities are recorded in [checks.json](../../output/playwright/issue-114/checks.json).

## Visible word counts

Counts include all scrollable screen content, shared visible navigation and two logo words. They exclude icons, collapsed navigation, invisible lock reasons/live announcements and the offscreen skip link. Repeated phone channel labels are included. These are measurements, not targets.

| State | Customer 1440 | Customer 390 | Tradie 1440 | Tradie 390 |
|---|---:|---:|---:|---:|
| default | 44 | 40 | 64 | 76 |
| empty | 25 | 9 | 29 | 9 |
| loading | 23 | 7 | 27 | 7 |
| error | 25 | 12 | 29 | 12 |
| offline | 45 | 41 | 65 | 77 |
| saving | 44 | 40 | 64 | 76 |
| saved | 46 | 42 | 66 | 78 |
| save-error | 48 | 44 | 68 | 80 |
| expired | 50 | 46 | 70 | 82 |

Existing Security regression counts (content preserved):

| State | Customer 1440 | Customer 390 |
|---|---:|---:|
| default | 83 | 70 |
| wrong | 95 | 82 |
| success | 91 | 78 |
| unavailable | 92 | 79 |
| loading | 20 | 7 |
| limited | 89 | 76 |
| invalid-link | 96 | 83 |
| pending-email | 96 | 83 |
| partial | 101 | 88 |
| expired | 94 | 81 |
| offline | 88 | 75 |
| pending | 81 | 68 |
| access-errors | 110 | 97 |

Tradie Security default: **87** desktop, **70** phone. Full counted strings: [notifications](../../output/playwright/issue-114/word-counts.json), [Security](../../output/playwright/issue-114/security-word-counts.json).

## Screenshot index

Mockup is left, build is right.

| Notification state | Customer desktop | Customer phone | Tradie desktop | Tradie phone |
|---|---|---|---|---|
| default | [pair](../../output/playwright/issue-114/pair-customer-default-1440.png) | [pair](../../output/playwright/issue-114/pair-customer-default-390.png) | [pair](../../output/playwright/issue-114/pair-trade-default-1440.png) | [pair](../../output/playwright/issue-114/pair-trade-default-390.png) |
| empty | [pair](../../output/playwright/issue-114/pair-customer-empty-1440.png) | [pair](../../output/playwright/issue-114/pair-customer-empty-390.png) | [pair](../../output/playwright/issue-114/pair-trade-empty-1440.png) | [pair](../../output/playwright/issue-114/pair-trade-empty-390.png) |
| loading | [pair](../../output/playwright/issue-114/pair-customer-loading-1440.png) | [pair](../../output/playwright/issue-114/pair-customer-loading-390.png) | [pair](../../output/playwright/issue-114/pair-trade-loading-1440.png) | [pair](../../output/playwright/issue-114/pair-trade-loading-390.png) |
| error | [pair](../../output/playwright/issue-114/pair-customer-error-1440.png) | [pair](../../output/playwright/issue-114/pair-customer-error-390.png) | [pair](../../output/playwright/issue-114/pair-trade-error-1440.png) | [pair](../../output/playwright/issue-114/pair-trade-error-390.png) |
| offline | [pair](../../output/playwright/issue-114/pair-customer-offline-1440.png) | [pair](../../output/playwright/issue-114/pair-customer-offline-390.png) | [pair](../../output/playwright/issue-114/pair-trade-offline-1440.png) | [pair](../../output/playwright/issue-114/pair-trade-offline-390.png) |
| saving | [pair](../../output/playwright/issue-114/pair-customer-saving-1440.png) | [pair](../../output/playwright/issue-114/pair-customer-saving-390.png) | [pair](../../output/playwright/issue-114/pair-trade-saving-1440.png) | [pair](../../output/playwright/issue-114/pair-trade-saving-390.png) |
| saved | [pair](../../output/playwright/issue-114/pair-customer-saved-1440.png) | [pair](../../output/playwright/issue-114/pair-customer-saved-390.png) | [pair](../../output/playwright/issue-114/pair-trade-saved-1440.png) | [pair](../../output/playwright/issue-114/pair-trade-saved-390.png) |
| save-error | [pair](../../output/playwright/issue-114/pair-customer-save-error-1440.png) | [pair](../../output/playwright/issue-114/pair-customer-save-error-390.png) | [pair](../../output/playwright/issue-114/pair-trade-save-error-1440.png) | [pair](../../output/playwright/issue-114/pair-trade-save-error-390.png) |
| expired | [pair](../../output/playwright/issue-114/pair-customer-expired-1440.png) | [pair](../../output/playwright/issue-114/pair-customer-expired-390.png) | [pair](../../output/playwright/issue-114/pair-trade-expired-1440.png) | [pair](../../output/playwright/issue-114/pair-trade-expired-390.png) |

| Security regression state | Desktop | Phone |
|---|---|---|
| customer default | [pair](../../output/playwright/issue-114/pair-security-customer-default-1440.png) | [pair](../../output/playwright/issue-114/pair-security-customer-default-390.png) |
| customer wrong | [pair](../../output/playwright/issue-114/pair-security-customer-wrong-1440.png) | [pair](../../output/playwright/issue-114/pair-security-customer-wrong-390.png) |
| customer success | [pair](../../output/playwright/issue-114/pair-security-customer-success-1440.png) | [pair](../../output/playwright/issue-114/pair-security-customer-success-390.png) |
| customer unavailable | [pair](../../output/playwright/issue-114/pair-security-customer-unavailable-1440.png) | [pair](../../output/playwright/issue-114/pair-security-customer-unavailable-390.png) |
| customer loading | [pair](../../output/playwright/issue-114/pair-security-customer-loading-1440.png) | [pair](../../output/playwright/issue-114/pair-security-customer-loading-390.png) |
| customer limited | [pair](../../output/playwright/issue-114/pair-security-customer-limited-1440.png) | [pair](../../output/playwright/issue-114/pair-security-customer-limited-390.png) |
| customer invalid-link | [pair](../../output/playwright/issue-114/pair-security-customer-invalid-link-1440.png) | [pair](../../output/playwright/issue-114/pair-security-customer-invalid-link-390.png) |
| customer pending-email | [pair](../../output/playwright/issue-114/pair-security-customer-pending-email-1440.png) | [pair](../../output/playwright/issue-114/pair-security-customer-pending-email-390.png) |
| customer partial | [pair](../../output/playwright/issue-114/pair-security-customer-partial-1440.png) | [pair](../../output/playwright/issue-114/pair-security-customer-partial-390.png) |
| customer expired | [pair](../../output/playwright/issue-114/pair-security-customer-expired-1440.png) | [pair](../../output/playwright/issue-114/pair-security-customer-expired-390.png) |
| customer offline | [pair](../../output/playwright/issue-114/pair-security-customer-offline-1440.png) | [pair](../../output/playwright/issue-114/pair-security-customer-offline-390.png) |
| customer pending | [pair](../../output/playwright/issue-114/pair-security-customer-pending-1440.png) | [pair](../../output/playwright/issue-114/pair-security-customer-pending-390.png) |
| customer access-errors | [pair](../../output/playwright/issue-114/pair-security-customer-access-errors-1440.png) | [pair](../../output/playwright/issue-114/pair-security-customer-access-errors-390.png) |
| tradie default | [pair](../../output/playwright/issue-114/pair-security-trade-default-1440.png) | [pair](../../output/playwright/issue-114/pair-security-trade-default-390.png) |

Before/after shared-kit regressions: [customer 1440](../../output/playwright/issue-114/pair-security-regression-customer-1440.png), [customer 390](../../output/playwright/issue-114/pair-security-regression-customer-390.png), [trade 1440](../../output/playwright/issue-114/pair-security-regression-trade-1440.png), [trade 390](../../output/playwright/issue-114/pair-security-regression-trade-390.png).

## Reproduction and ownership

Configs and capture scripts are beside the evidence. Local ports: 3114 normal production e2e, 3314 guarded built preview, 3214 signed-in app, 4114 mockups, 54337 disposable Postgres and 54338 Auth HTTP double. The signed-in suite refuses non-local databases and requires a name containing `local_notifications`. Node 22.23.4 satisfies the repository major requirement. Service variables are blank for build/preview tests.

Heavy checks ran serially under the shared atomic lock, with one test worker and at most two build workers; temporary build CPU configuration was restored. No other worker checkout, process or lock was modified. No merge or deployment was performed.

Made by: Codex.
