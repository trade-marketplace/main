# Verification · #213

Application and test source: `49934c34aafc6244a6dae40081f6a6566b9a1f27`, rebased onto latest main `faaf5d2587ae5dcb19492da628814e3848f29c57`. Final evidence commit changes only review screenshots, word counts and documentation. All required gates pass; no merge or manual deployment.

| Required gate | Final result |
|---|---|
| `npm run lint` | Passed, exit 0 |
| `npm run typecheck` | Passed, exit 0 |
| `npm test -- --maxWorkers=1` | 105 files, 2,202 passed, 0 failed, 0 skipped; 52.82 s |
| `npm run build` | Passed, invoked once by `npm run e2e` |
| `npm run e2e` with task-specific Playwright config | 199 passed, 445 conditional skips, 0 failed |
| Explicit For tradies browser run with guarded previews enabled | 32 passed, 0 failed, 0 skipped |
| Production-build capture run | All states captured at 1440/390; Open Graph and Twitter routes both 200 |

The default production e2e configuration intentionally skips guarded development and signed-in fixture tests without their existing environment flags. Its 445 skips include the 20 new preview-state cases; all 20 execute in the separate 32-test For tradies run. No required For tradies coverage is skipped. Existing assertions, timeouts, skip conditions and dependencies were preserved.

The explicit browser run covers ready, empty, loading and error at 320/390/768/1024/1440; no horizontal overflow; axe; keyboard FAQ and visible focus; CTA navigation through real signup account Next/Back; mobile menu dismissal; M06/M07 and reduced motion. Two visual correction passes were preserved locally before final captures, then the header geometry was corrected. Every final desktop/phone state capture was personally inspected. Reference limitations and all images are in [README.md](README.md).

The first post-rebase unit run passed 2,197 tests and failed only the automatically discovered dev-page inventory because its cached import list omitted the new upstream Recovery page. Following that test's documented instruction, clearing only this checkout's generated `node_modules/.vitest-cache` restored all 2,202 tests without source/assertion changes. Earlier resource-contention and trace-cleanup attempts were superseded by these serial final runs; runner output directories are isolated.

Checks used checksum-verified supported Node 22.22 and real Playwright Chromium. Heavy checks ran serially under `/tmp/trade-marketplace-heavy-check.lock`, with one unit worker and at most two build/browser workers; the task released its lock. Full runner logs and both earlier visual passes remain in the local task workspace's `verification/` directory.

Database tests used only disposable local Postgres `trade-213-tests` on 127.0.0.1:55413. App/build/browser checks set database and Supabase variables empty. Preview earnings use fixed isolated settings; production reads server settings per request and never substitutes preview amounts. No live database, secrets, security configuration, financial actions, merge or manual deployment.

Public URL HEAD checks: homepage 200; `/for-tradies` 404 until merge/deployment. Existing Open Graph and Twitter source is untouched and both local routes return 200. Issue was open/unclaimed without a covering PR when claimed with exactly `Taking this — Codex`; prerequisite #83 is closed.

Made by: Codex (GPT-6.1).
