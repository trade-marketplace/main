# Service pages — issue #245

A04 at `/services/electrical`, `/services/plumbing`, `/services/gas`, `/services/construction` and `/services/other`.

The five launch trades come from the current category config and DECISIONS #333. `src/server/services.ts` supplies the content and availability contract. All five are live at launch; setting a configured trade to `live: false` renders its coming-soon hero and waitlist instead of job actions. No extra launch trade or release date is invented. The later office-managed trade/CMS backend remains outside this issue.

Coverage is read from office Settings on each request. Public reviews are restricted to visible reviews for the requested job trade, with only rating, comment and the reviewer's first name sent to the browser. No production review is invented: the section is hidden when there are none. The guarded `reviews` fixture contains an explicitly identifiable demo record solely to exercise the rendered state.

## Components and content

- Public shell: `SiteShell`, `SiteHeader`, `SiteFooter`, `FocusVisibility`, `BoltMark`.
- Buttons and fields: `Button`, `TextField`, `AddressField`; location uses the shared `Dialog`, including Escape/focus return and M08 suggestions.
- Cards: new reusable `ServiceJobCard` variant in the existing cards set, with the same stretched link, category tints, card radius/shadow and M03 hover lift.
- Feedback/status/media: `EmptyCard`, `ErrorState`, `LoadingRegion`, `Skeleton`, `Banner`, `Pill`, `Avatar`, `StarRating`, `Icon`, plus the existing online-status hook.
- The public search, steps, review cards and CTA reuse the homepage's CSS and approved step paragraphs. No changes to the Help centre, How it works, Contact or existing homepage content.
- Existing data, map, app and office shell components were inventoried; these public marketing pages do not need a table, map, app navigation or office shell.
- Original 500px service artwork comes directly from the approved `docs/design/img` files. Category thumbnails and other pages remain unchanged.
- Colours, type, spacing, shape, elevation and motion reuse `tokens.css` and the kit; no new fonts, hex colours, emoji, Tailwind or custom animation. The mockup’s missing 19px supporting-copy and 30px artwork-radius values are shared tokens in both design/app files; existing token values are unchanged.

Named jobs prefill their description and trade. “Something else” keeps the entered description. `/services/other` always retains `type=other`, including moving, cleaning, gardening and assembly. Location and bounded text survive the existing job-start URL, session draft, login and signup Next/Back handoffs. Outside coverage leads to the existing area waitlist. The job wizard itself remains in its own issue; this PR does not claim a completed job-posting journey.

The separate `service_waitlist_entries` table stores email, suburb and trade, with an atomic uniqueness constraint per email/suburb/trade. The existing area waitlist is unchanged. The server validates every field; absence/failure of the database never produces a success message. RLS has no client policies. William must review the migration and public action; Matt must review screens/copy. No live migration is run by this task.

## Review states

Locally, `/dev/components/services?state=<state>&trade=<trade>` exposes:

`live`, `empty`, `loading`, `error`, `reviews`, `reviews-error`, `coming-soon`, `sending`, `joined`, `already-on-list`, `waitlist-error`, `offline`.

The shared dev-page guard runs first. Production/preview deployments refuse these routes; the screenshot workflow can enable them locally with `SCREENSHOT_DEV_PAGES=1`. Public state query parameters cannot change trade availability or invent a saved signup.

## Visual evidence

The desktop reference is `docs/design/pages.html#w-service`, opened in installed Chromium at 1440px; its 40px fake browser bar is excluded, yielding a 1440×1000 content image. The coming-soon form also follows A07's waitlist reference. Both source files were opened before implementation.

There is no dedicated service phone mockup in `screens.html`. The 390×844 public landing screen is the closest phone reference. Its source device status/home bars remain visible in the reference; the website does not recreate device chrome. The service hero/search/grid reflow using the existing public shell and fields. Coming-soon and list/review failure/loading variants have no exact standalone mockup; their comparisons show the service template alongside the corresponding kit state. The service mockup ends after the popular grid, so the required steps/reviews/CTA below it follow the existing public landing composition.

`pass1` and `pass2` contain equal-size mockup/build pairs for every state at 1440 and 390, plus full-page captures and each other trade template. Visible main-content word counts are QA measurements, never cutting targets. Screen reader-only labels and decorative icon text are excluded. The final PR links the captures and reports the two inspection passes and their limits.

## Verification

Final command results and exact counts are recorded in `verification.json` and the command logs. Heavy suites and browser capture are serialized with `/tmp/trade-marketplace-heavy-check.lock`, acquired atomically with the owning process PID; only this task's lock/resources are released.

The checks use Node 22, installed Google Chrome and a disposable PostgreSQL 17 cluster in UTC. Application database/Supabase environment variables are blank; only database tests receive the disposable test URL. No live Supabase, production data, secrets, deployment, merge, auto-merge or main-branch push is used.

Initial checks caught a missing accessible loading heading and the need to register the intentionally public service waitlist action in the action inventory. Production checks also caught a streamed 404 screen returning HTTP 200; the loading boundary was moved after trade validation. These failures were corrected without disabling an assertion or accessibility rule. One earlier production run ended without completion and left this task's own test server on port 3100; its cwd/PID were verified before cleanup. That partial run is not counted as passing.

Made by: Codex (GPT-6 family).

## Final inspection and counts

Both passes were personally inspected: all 12 states at 1440 and 390 (48 equal-size pairs), full review/failed-review sections below the fold, and the other four trade templates at both widths in each pass. Pass 1 led to fixes for card line spacing/tints, the empty-card gap, hero copy/artwork values and duplicated phone step numbers. Pass 2 confirmed those refinements. Shared header behavior remains the existing approved public shell. The mockup’s blanket “CoC every time” claim is deliberately omitted; no new insurance or licensing promise is introduced.

Final gates: lint/typecheck/build passed; **2,224 unit/database tests passed, zero skipped**; standard production e2e **209 passed, 442 conditional skips**; dedicated production feature cases **22 passed, zero skipped**. The standard skips comprise 433 pre-existing opt-in cases and nine guarded service fixture cases; all nine fixture cases ran explicitly in the dedicated suite. The tested source commit and source-tree hashes are in `verification.json`; subsequent publication adds only QA files.

See [word counts](WORD_COUNTS.md), [verification](verification.json), [command logs](logs/) and [final comparison pairs/full pages](pass2/). Duplicate standalone viewport captures are omitted because the pair images contain those exact pixels; all 48 comparison pairs remain.

To repeat the dedicated cases using the standard repository runner, set `E2E_DEV_BASE_URL=http://127.0.0.1:3100 SCREENSHOT_DEV_PAGES=1` and run `npm run e2e -- tests/e2e/services.spec.ts --workers=1` with database/Supabase variables blank. Use a local build only; the dev-page guard still refuses real Vercel deployments. The recorded run instead used the equivalent minimal runner against its already-running isolated production server on port 3245.
