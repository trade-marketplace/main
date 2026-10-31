# Help centre #185 — final local verification

Verified implementation: `bd7c20d09fb0f04cc912fdb94d20e7115b562121`, branch `feat/185-help-centre`, based on current `main` at `b7a48687dc295d855211bf58c6414ec1eb9bcfbc`. The implementation was unchanged during final verification. QA evidence is kept alongside the implementation on this branch. This directory supersedes earlier verification and capture attempts in its parent directory.

The Help home, topic filters, keyboard search, Markdown articles, mobile FAQs, and server-persisted Yes/No feedback are implemented. “No” records immediately and offers an optional note; successful feedback is shown only after a database acknowledgement. Unknown articles return HTTP 404 with one public shell. No live database was accessed or migrated.

## Checks on this exact source

| Command / flow | Result | Evidence |
| --- | --- | --- |
| `npm run lint` | Passed | [lint.txt](lint.txt) |
| `npm run typecheck` | Passed | [typecheck.txt](typecheck.txt) |
| `npm test -- --maxWorkers=1` | 2,215 passed, 108 files, zero skips | [unit.txt](unit.txt) |
| `npm run build` | Passed | [build.txt](build.txt) |
| `npx playwright test tests/e2e/help.spec.ts --workers=2` | 10 passed, zero skips | [help-e2e.txt](help-e2e.txt) |
| `npx playwright test --workers=2` | 206 passed, 433 existing guarded cases skipped | [e2e.txt](e2e.txt) |
| Real browser and disposable PostgreSQL flow | 7 checks passed | [feedback-browser.json](feedback-browser.json) |

Runtime: Homebrew Node 22.22.0 and installed Google Chrome. The unit run used only disposable PostgreSQL on localhost port 54185. The dedicated browser suite covers 45 state/viewport combinations at 320, 390, 768, 1024, and 1440px, including axe checks, keyboard suggestions, phone FAQ/filter/article navigation, unavailable feedback persistence, HTTP 404, and the phone shell before hydration. The separate real database journey verifies immediate No persistence, note persistence, acknowledged success, cookie continuity, one-row vote changes, and 404 recovery.

The full standard browser suite ran against the same corrected source and production build. The 433 skips are existing conditional dev/guarded cases in the standard production run. All 10 Help cases ran without skips. No test-maintenance changes were made. The local source hash is recorded in [e2e-source.txt](e2e-source.txt).

## Visual review

Both complete passes were personally inspected: 10 states at 1440×960 and 390×800, **40 mockup/build pairs**, plus viewport and full-page images. Every capture reports zero horizontal overflow. The two passes render identically across all 20 corresponding pairs. The error retry control measures 55px high at both widths. See [visual-review.json](visual-review.json), [control-measurements.json](control-measurements.json), [pass 1](visual-pass-1/), and [pass 2](visual-pass-2/).

Representative final pairs: [desktop article](visual-pass-2/pair-article-1440.png), [phone home](visual-pass-2/pair-home-390.png), [phone note](visual-pass-2/pair-not-helpful-390.png), [phone feedback error](visual-pass-2/pair-feedback-error-390.png). The [full phone note page](visual-pass-2/not-helpful-390-full.png) also shows the support card, related links, and public footer below the viewport.

References were captured in Chromium before implementation from `docs/design/pages.html#w-help` and `docs/design/screens.html#sh-support`. Each pair has the normalized reference on the left and the build on the right. Only the mockup's top browser/OS chrome (40px desktop, 44px phone) was cropped to give equal web-content panels.

Reference limits and deliberate differences:

- No desktop Help home or phone article is drawn; those states use the closest Help reference. States absent from the drawing use shared kit controls and feedback components.
- Phone retains a scrollable Tradies chip required by the topic inventory, plus the reference's four chips. Browser content does not reproduce the OS home indicator.
- The desktop Forest support rail is retained. Related links use readable Lime rather than the mockup catalogue's accidental low-contrast global aside styling. Coloured button labels use Forest as required by decisions.
- Article date and reading duration come from Markdown metadata/content rather than the mockup's example values. The payment explanation preserves **all 64 words exactly**; see [article-copy.json](../article-copy.json).
- “Message us” opens the approved `hello@trademarketplace.nz` email. The separate #186 support inbox is not implemented here.

The capture utility counts extracted page text plus control values/placeholders, including below-viewport navigation/footer and accessibility text. It excludes hidden/inert content and icon glyphs. Counts are measurements, not copy-cutting targets; the JSON records the exact text. Both passes have the same counts:

| State | 1440px words | 390px words |
| --- | ---: | ---: |
| Home | 109 | 84 |
| Search results | 99 | 84 |
| Suggestions | 121 | 109 |
| No results | 77 | 65 |
| Loading | 60 | 49 |
| Error | 63 | 52 |
| Article | 179 | 148 |
| Helpful voted | 178 | 147 |
| Not helpful / optional note | 186 | 155 |
| Feedback error | 193 | 156 |

## Handoff and cleanup

The task-owned PostgreSQL process (former PID 72747, port 54185, `/tmp/trade-185-postgres/data`) was stopped with its own `pg_ctl`. Ports 3100, 3185, 8185, and 54185 have no listeners. The worker's heavy-check lock is released. Browser contexts and preview processes are closed. Database files remain local; QA evidence is preserved. See [cleanup.json](cleanup.json).

Matt's screen/copy review and William's schema review remain appropriate before merging. No live migration has been performed.

This evidence is prepared for the user-authorized draft PR. Hosted CI and preview status are reported on that PR. Production currently returns 404 for the new Help routes; [live-links.json](live-links.json) records those checks. No manual deployment, main push, merge, or auto-merge is part of this task.
