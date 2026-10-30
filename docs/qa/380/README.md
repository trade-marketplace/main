# Issue #380 verification

Scope: the local-Git screenshot publishing race test in `tests/unit/screenshots.test.ts`.
Final base: `b7a48687dc295d855211bf58c6414ec1eb9bcfbc`.
Tested source commit: `0bc36c5` (the final publication adds only this evidence).
Command-log content is preserved with trailing terminal whitespace normalized;
raw captures remain locally in `/tmp/issue380-tools/raw-logs/`.

## Investigation and bounded reproduction

The unchanged race case passed in **1,083 ms** in one isolated baseline run on
Node 22.22.0 / Apple Git 2.54.0. The historical issue records a **5,177 ms**
timeout during a normal complete suite on a busy Mac. We did not recreate load
with stress benchmarks. `baseline-race.txt` is the exact targeted run; its 50
filtered tests are not executed by that name-filtered command.

Git trace events from that run counted **67 directly invoked Git commands and
103 process starts including Git helpers**. These include four fetches, four
tree/commit builds and four pushes: PR 1, the first PR 3 attempt, the injected PR 2
publish, and the successful PR 3 retry. One push is intentionally rejected by
`--force-with-lease`. Direct command elapsed times total 0.425277 seconds (nested
helper time is included there); the slowest individual direct command was a
0.052185-second push. The rest of the measured case includes process-launch and
fixture/assertion work. `baseline-git-summary.json` records those counts. There
was no single stalled Git command or proven publishing defect.

The branch movement already uses the deterministic `beforePush` callback rather
than timing or sleeps. The test keeps that callback and both original assertions
verbatim: the first-attempt retry message and preservation of all three 1440px
paths. It now also checks exactly attempts `[1, 2]` and all six 1440px/390px files.
A shared fixed fixture date removes wall-clock input to retention. `finally`
cleans up the throwaway repositories if an assertion fails.

Only this integration-style test receives a **15,000 ms** deadline: approximately
three times the former default / historical 5.177-second failure, for its real
Git work under parallel-suite contention. This remains a finite failure budget;
no global timeout, retry policy, skipped test, production script, assertion or
worker configuration is changed in the repository.

After the change, the whole screenshot file passed **51/51**, zero skipped,
in **2.56 seconds**; the race case took **1,194 ms** (`focused.txt`).

## Verification boundaries

Heavy operations use the atomic shared `/tmp/trade-marketplace-heavy-check.lock`
with this task's issue/PID/checkout recorded, and release it on exit. A held lock
is respected. Final units use one worker as CI requires for shared role grants;
focused tests, build and browser checks use at most two workers. The build worker
cap is process-local (`CIRCLE_NODE_TOTAL=3` makes Next's default CPU count two;
`RAYON_NUM_THREADS=2`), with no config edit.

Database tests use a fresh task-only native PostgreSQL 17.10 instance on
`127.0.0.1:54380`, in UTC, with per-file migrated schemas. Application database and
Supabase variables are blank. No live Supabase, secrets or user settings are used.
Standard e2e uses the repository configuration and installed Google Chrome;
its existing conditional skip counts are disclosed with the results.

Screenshots, mockup pairs, UI word counts and manual role journeys are **N/A**:
this changes test infrastructure only and has no visible UI change. No visual
artifacts are generated for this issue.

GitHub denied reading the issue's project-board item because the CLI token lacks
`read:project`; no board move was performed. The claim succeeded and the exact
missing permission was commented on #380. No auth scopes were changed.

The first complete gate run on `faaf5d2587ae5dcb19492da628814e3848f29c57`
passed lint, typecheck, all 2,191 units/database tests (104 files, no skips), build,
and standard e2e (187 passed, 425 existing conditional skips). Its exact logs are
in `previous-base/`. Main then advanced because PR #396 was merged externally.
This task did not merge or modify that PR. The fix rebased cleanly onto the new
main; generated checkout caches were cleared before the required final rerun.

That rerun's first unit pass exposed the explicitly documented Vitest glob cache:
`dev-pages.test.tsx` found `/dev/components/waitlist` on disk but its cached eager
glob retained the old inventory (2,199 passed, one failed, four newly discoverable
guard cases absent). The test's own instructions specify deleting
`node_modules/.vitest-cache`; clearing `.vite`/`.next` earlier had not cleared
that cache. We cleared the documented directory and reran the entire unit suite
with the same assertions and deadline settings. The original failed log is
preserved as `test.txt`, with the fresh run in `test-after-cache-clean.txt`.

Final gate results are recorded in `outcomes.txt` and the individual command logs.

| Final check | Result | Log |
|---|---|---|
| `npm run lint` | Passed, no warnings | `lint.txt` |
| `npm run typecheck` | Passed | `typecheck.txt` |
| `TEST_DATABASE_URL=<disposable local DB> npm test -- --maxWorkers=1` | 2,204 passed, 106 files, zero skipped, 50.04s | `test-after-cache-clean.txt` |
| `npm run build` | Passed, two page-data/static-page workers | `build.txt` |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=<installed Chrome> npx playwright test --workers=2` | 196 passed, 433 existing conditional skips, zero failures, 2.9m | `e2e.txt` |

The final unit run required no source, assertion or timeout change after clearing
the documented cache. The earlier failed unit attempt remains visible in
`outcomes.txt`; every required check has a successful final outcome on the same
source. The disposable PostgreSQL server was stopped and this task's heavy-check
lock released after verification. No pending PR was modified or merged by this
task, and no manual deployment was performed.
