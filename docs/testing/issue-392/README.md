# Issue 392: tracked-file demo-password scan

Final base: `b7a48687dc295d855211bf58c6414ec1eb9bcfbc` (latest main, rechecked before publication).
Verified source commit: `31763a7` (subsequent commit adds only this QA evidence).
Only implementation change: `tests/unit/seed.test.ts`. No app, schema, security behavior, dependency,
configuration, deadline or test skip changes. Screenshots and visible word counts: N/A (test-only change).

## Cause and fix

On initial base `faaf5d2`, the original test synchronously opened and decoded each of 571 tracked files (5,657,073 bytes) inside the
five-second test. Issue 392 records a 6,427 ms failure during concurrent build/browser work. One bounded,
serialized baseline here passed; no artificial load or broad stress benchmark was run.

The same tracked-file list and existing image/font exclusions remain. `git grep` searches those exact
working-tree files for the literal assignment prefix, with two threads, forced text scanning, NUL-delimited
filenames, literal pathspecs and external text conversion disabled. JavaScript then reads every candidate
and applies the original regex unchanged. An assignment cannot match that regex without the literal prefix.
The assertion still reports only offending filenames. Git status 1 means no candidate; other command failures
propagate. The seed-code, environment-example and data-preservation assertions are unchanged.

A single old/new measurement on the same checkout found identical results (zero offenders):

| Operation | Files opened in JavaScript | Bytes decoded in JavaScript | Elapsed |
|---|---:|---:|---:|
| Original scan | 571 | 5,657,073 | 260.99 ms |
| Git prefix scan + original regex | 1 | 3,716 | 84.25 ms |

Git still scans the entire required set. The second elapsed time includes the Git scan and candidate read.
These are one local comparison, not a performance guarantee. No timeout was increased.

The regression creates an isolated temporary Git index with safe synthetic fixture values, then checks
unstaged assignments, literal brackets, spaces/newlines in filenames and NUL-containing files. It verifies
that empty assignments, `<placeholder>` and Unicode whitespace keep the original behavior, untracked files
are excluded, and a no-prefix result is accepted. The temporary fixture is removed in `finally`.

## Verification

- `npx vitest run tests/unit/seed.test.ts --maxWorkers=1 -t 'no hard-coded demo password'`: baseline 3 passed,
  22 deselected; changed suite 4 passed, 22 deselected. The added case is the scan regression. These focused
  deselections are intentional; the full unit/database run below skipped nothing.
- `npm run lint`: passed, 10 seconds.
- `npm run typecheck`: passed, 9 seconds.
- `npm test -- --maxWorkers=1`: 106 files / 2,205 tests passed, zero skipped, 48.07 seconds.
- `npm run build`: passed, 16 seconds; temporary local `experimental.cpus: 2` cap restored after build.
- `npx playwright test --workers=2`: standard production e2e, 196 passed, 433 existing conditional skips,
  zero failures, 2.2 minutes. No optional component catalogue run or fixture opt-in was added.

Final gates all used Node 22.23.4. On the initial base, standard e2e under Node 22.17.0 stopped during test discovery with Node's internal
`Unexpected module status 3` while importing Supabase; no tests ran in that attempt. Its exact log is retained.
An already available Node 22.23.4 runtime, supported by `.nvmrc` / the package engine range,
resolved discovery without dependency changes. The pre-rebase retry passed 187 tests with 425 existing
conditional skips. Main then advanced by merging #396 upstream; the isolated test commit rebased cleanly
and every required gate ran again on the final base. This task did not merge or modify #396 or any other PR. Chrome is the existing installed Google Chrome via the
repository's documented `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` setting.

Heavy work runs serially under atomic `/tmp/trade-marketplace-heavy-check.lock`, with issue/PID ownership
and trap-based cleanup; no other lock or process is touched. The unit run used task-owned disposable
Postgres 17 bound only to localhost, UTC, one worker and real per-file migrations. Database/host clock
measurements differed by about 90 ms. The container was removed after the run. App/database/Supabase
variables were blank for the build and standard browser run. No live Supabase, secrets or user settings
were used or changed.

Exact logs and the old/new measurement are beside this report. No visual artifacts were generated.
