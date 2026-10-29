# Verification status · #213

Implementation is committed and based on main `3c7344f`. Final verification is pending shared test capacity; no PR, merge or manual deployment.

All checks preserve their assertions and timeouts. Heavy runs are stopped while #184 owns `/tmp/trade-marketplace-heavy-check.lock`. Orchestration files are outside the checkout in the task workspace's `verification/` directory. Final runs will be serial, with one unit-test worker and at most two browser workers.

## Completed evidence

- Issue was open/unclaimed, with no covering open PR. Claimed with exactly `Taking this — Codex`.
- Existing prerequisite #83 is closed. No project board item exists for #213.
- Real Chromium mockup captures at 1440 and 390 preceded code. No specific phone For tradies frame exists; closest public landing frame used.
- Two visual correction passes, followed by the header geometry correction, are preserved locally. Every current desktop/phone state pair was personally inspected.
- Public URL HEAD checks: homepage 200; `/for-tradies` 404 until merge/deployment.
- Existing local Open Graph and Twitter routes both return 200 and their source files are untouched.
- Lint and typecheck passed earlier; production builds pass, including the final force-dynamic server route. Final source checks will be rerun after the last copy/test adjustment.
- Initial focused unit checks: 33 passed across For tradies and existing site-shell tests.

## Previous complete runs under shared load

| Run | Exact result | Remaining problem |
|---|---|---|
| Unit/database, initial | 2,146 passed; 3 failed; 0 skipped | Profile timestamp (#346), same-millisecond estimate timestamp, screenshot race timeout (#380). These files are unchanged from main. |
| Retry of those three files | 115 passed; 1 failed; 0 skipped | Profile timestamp equality (#346); estimate and screenshot checks passed. |
| Unit/database under Node 22.22 and heavy shared load | 2,147 passed; 2 failed; 0 skipped | Unchanged seed-file scan (5s) and ESLint-ignore probe (30s) exceeded their timeouts. Timestamp and race checks passed. |
| Full e2e under Node 22.22 | 188 passed; 3 failed; 434 conditional skips | Two trace cleanup collisions between my local runner configs, plus one context-teardown timeout. Page assertions passed. Separate output directories now prevent the collision. |
| Focused For tradies browser run after header correction | 31 passed; 1 failed; 0 skipped | Same trace cleanup collision at 1440; page/axe assertions passed. M06/M07 passes. |

The full production-mode e2e run includes guarded development and signed-in fixture tests that intentionally skip without their existing environment flags. The 20 new preview-state cases are separately exercised with guarded local previews enabled. No required For tradies state is intended to be skipped in the final focused run.

The initial Node 22.17 full e2e collection hit `Unexpected module status 3` in an unchanged Supabase import. The official checksum-verified Node 22.22 runtime resolves that collection error; no dependency/engine requirement was changed.

## Still required

Fresh lint, typecheck, the entire unit/database suite, production build/full e2e, all focused preview checks, refreshed 1440/390 screenshots and word counts, and final inspection. The final PR will only be opened as a draft if every gate passes. Otherwise the exact blocker will be recorded on #213 without a PR.

Database tests use only disposable local Postgres `trade-213-tests` on 127.0.0.1:55413. App/browser checks set database and Supabase variables empty. No live database, secrets, auth/security configuration, financial actions, merge or manual deployment.
