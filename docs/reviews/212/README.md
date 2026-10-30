# How it works · #212

Route: `/how-it-works`. State: Default. The page is static; it does not fetch a quote, worker, payment, or list, so no loading/empty/error variant is applicable.

References were opened in real Chromium before implementation: `docs/design/pages.html#w-how` at 1440 and `docs/design/screens.html#pub-landing` at 390. There is no dedicated How it works phone mockup. The phone reference supplies the shared public shell, typography and kit; the step layout adapts A02's desktop rows.

## Visual review

Two comparison passes were personally inspected at both widths. Pass 1 exposed the browser's default 16px list margin. That margin was removed. The final pass also preserves the desktop heading positions with whitespace where the removed supporting paragraphs were. The phone layout keeps each outlined number with its heading and places its miniature below.

| Width | Reference / build pair | Full built page |
|---|---|---|
| 1440 | [Final pair](pair-1440.png) | [Default](default-1440.png) |
| 390 | [Final pair](pair-390.png) | [Default](default-390.png) |

[First desktop pass](pass1-pair-1440.png) · [First phone pass](pass1-pair-390.png).

The paired images show equally sized crops: 1440 × 1160 and 390 × 844. The source design's index and fake desktop browser chrome are excluded. The phone reference retains its drawn OS bars. Full-page captures preserve the essentials, questions, final CTA and unchanged footer below those crops.

Kit inventory: buttons/links, fields, cards, status, overlays, feedback, data, media, map, shells and `src/styles/tokens.css`. This route composes the existing button/link, field, card, status, icon/bolt and media kit, plus the shared landing layouts and motion hook.

## Copy and data

The latest task instruction overrides the older supporting-copy guidance. The hero subtitle and step paragraphs are removed. Essentials reuse approved labels: Free to post, One fixed price, No surprise bills. FAQ questions link to the separate Help route; no new answers or guarantees are invented.

The source mockup's sample dollar amount, worker name and rating are replaced with neutral kit icons. The miniatures are decorative and noninteractive; only their outer wrappers respond to M03 hover. The sample description and photos are the mockup's existing illustration. No mock amount or person is presented as server data.

Full-page main-content count: **52 words at 1440 and 52 at 390**, including the decorative description and button text. Counts exclude icon ligature names, step digits and hidden accessibility text. The shared shell is measured separately in `counts.json` (95 desktop / 87 phone, excluding SVG artwork).

## Validation

The five required widths (320, 390, 768, 1024, 1440) are covered by real browser overflow and axe checks. Browser tests also cover keyboard skip navigation and visible focus, job start → login → signup → Back with the original return destination, the phone menu, the Help hand-off and browser Back, M01 once on scroll, actual M03 lift, and reduced motion.

The public site shell, homepage and site links are unchanged. `/help` currently returns the existing 404 (#185); the job wizard remains separately scoped, with its current login return destination verified. Production returned 200 at `/` and 404 at `/how-it-works` before this PR; the new public route requires the normal approved merge/deployment.

Final checks run serially under the shared heavy-check lock. Unit tests use isolated Node and PostgreSQL 17 containers on one VM clock, with one worker. Mac checks use isolated Node 22.23.4, installed Chrome and a dedicated app port; e2e uses two workers. Supabase is unset. Current main includes the deterministic #346 timestamp assertion. Earlier local load/clock observations (#346 / #380) and the Node 22.17 collection incompatibility (#391) do not change any assertion or timeout. Final aggregate results are in `checks.json`; raw machine logs remain local.

Final verified results on `53a689dfaef6` (base `faaf5d2587ae`): **2193 unit/database tests across 105 files**, **196 e2e passes**, **425 intentional existing e2e skips**. All **9** required route tests ran with zero skips. Lint, typecheck and the production build passed.
