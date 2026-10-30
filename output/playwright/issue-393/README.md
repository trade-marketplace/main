# Issue 393 verification

Only `tests/e2e/dev-feedback.spec.ts` changes application-related source. The stale CSS-module name matcher is replaced by the loading demo's `status` role, with the content container located immediately before that status. This preserves the container locator when `aria-busy` is removed after loading.

All original assertions remain: busy state, visible skeleton, delayed loading announcement, loaded job, cleared busy state, cross-fade class, cleared announcement and quick-load silence. The timers, text, assertions and component implementation are unchanged.

## Reproduction

`reproduce.log` records both original failures on the built app at `http://127.0.0.1:4393`, with `SCREENSHOT_DEV_PAGES=1`, `E2E_DEV_BASE_URL=http://127.0.0.1:4393` and two Chromium workers. Both failures report missing generated-class selectors.

## Environment

- Node 22.23.4; repository-pinned Playwright 1.64.1 / Chromium 1248.
- Isolated checkout and branch `test/393-feedback-semantic-selectors` from main `faaf5d2587ae5dcb19492da628814e3848f29c57`.
- Local Playwright configuration preserves the repository configuration except the test directory resolution and an owned localhost port, 4393.
- Database and Supabase variables blank for builds/browser runs. Unit tests use only an owned throwaway Postgres on localhost port 54993, with UTC timezone and isolated test schemas.
- Heavy runs acquire `/tmp/trade-marketplace-heavy-check.lock` atomically, record owner/PID and release it on exit. Vitest/Playwright use at most two workers. The final Next build temporarily limits its CPU worker pool to two in local configuration, restored afterward; this is not a source change.
- The initial reproduction build used Next’s default 13-worker pool before the local cap was applied; `build.log` preserves that exception. The final build/gates use two workers.
- The first sandbox attempts could build successfully but could not bind localhost or allocate Postgres shared memory. Authorized runs with local socket/process access are used for verification.

## Visual evidence

Mockup/build visual pairs, before-code screen inspection, visual passes and word counts: **N/A**. This is a test-only selector fix; no visible screen, layout, copy, token, component, motion or behavior changes. Existing width, keyboard and axe assertions in the feedback suite are run unchanged. No fabricated screenshots or word counts.

No changes for #361 or #394, no live services, merge or manual deployment.

## Final gate results

- `npm run lint`: passed (`lint.log`).
- `npm run typecheck`: passed (`typecheck.log`).
- `npm test -- --maxWorkers=2`: 104 files / 2,191 tests passed, zero skipped (`test.log`).
- `npm run e2e -- --config output/playwright/e2e.config.ts --workers=2`: build passed; 187 e2e passed / 425 existing conditional skips / zero failures (`e2e.log`).
- Focused slow/quick built-preview verification: 2 passed / zero skipped (`focused.log`).
- Full built-preview feedback spec: 20 passed / one skipped production-404 test because development previews are enabled / zero failures (`feedback.log`). All five widths, palette accessibility, keyboard retry, reduced motion and loading/offline behavior passed.

Source checked: `635978120003c2b442734cbafd3d9061dc4bf643`; evidence commit adds only QA configuration, documentation and logs. Production link `https://trademarketplace.nz/` verified HTTP 200. No project-board item exists for issue 393; the exact claim comment was posted. No remaining implementation blockers.

Terminal logs preserve command output with trailing whitespace/carriage returns normalized for Git.
