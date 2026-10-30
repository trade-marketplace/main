# Issue 404: homepage text resizing

Application scope: three `overflow-wrap: anywhere` declarations in the existing landing layout, on the steps, promises/photographs and FAQ grids. The inherited wrapping opportunity lowers their content-based minimum widths and keeps long words inside the available column. Existing tracks, spacing, tokens, components, fonts, colours, copy and category CSS are unchanged.

## Reproduction and result

The production homepage was inspected signed out in real Chromium, with database and Supabase disabled. The baseline is latest main `faaf5d2587ae5dcb19492da628814e3848f29c57`. Before changing application CSS, inspected `pages.html#w-landing` at 1440px and `screens.html#pub-landing` at 390px. The phone catalogue's sticky table of contents was hidden for its reference capture; the designed phone/status bars remain.

At 320 × 900, after hydration, layout flush and font readiness, computed root font is **32px** and FAQ heading is **56px**. Before the fix: **66px** document overflow; FAQ children reach **385.92px**, last step **338.81px**. Wrapping just FAQ/steps exposed **16px** from the adjacent promises grid. Applying the same wrapping rule there removes the remaining overflow. After the fix: **0px** page overflow. See `baseline.json`, `measurements.json`, `before-320-200.png`, `built-320-200.png`, and the three `built-320-200-{steps,promises,faq}.png` crops.

An early measurement read a 16px computed root immediately after setting the inline percentage and was rejected. Another read caught root size before descendant layout/font selection settled. Final evidence waits for hydration, flushes layout before font readiness, and verifies both the root and doubled heading. The committed regression also checks root size after keyboard interactions. No assertions, timeouts or expected overflow values were weakened. PR402's category code and tests are untouched.

## Personally inspected visual passes

Each pair has equal-size panels, mockup left and build right. Both passes were personally inspected at both widths, plus desktop step/FAQ detail pairs and the enlarged 320px sections.

| Panels | Pass 1 | Pass 2 |
|---|---|---|
| 1440 × 900 | `pair-1440-pass-1.png` | `pair-1440-pass-2.png` |
| 390 × 844 | `pair-390-pass-1.png` | `pair-390-pass-2.png` |
| Desktop steps, 1440 × 560 | `pair-steps-1440-pass-1.png` | `pair-steps-1440-pass-2.png` |
| Desktop FAQ, 1440 × 580 | `pair-faq-1440-pass-1.png` | `pair-faq-1440-pass-2.png` |

`full-pair-1440-pass-{1,2}.png` preserve the whole desktop reference/build. Individual full build images also exist for both widths/passes. Desktop viewport references omit the mock browser's 40px chrome. The original phone reference includes 44px of OS chrome; the browser build starts at page y=0. There is no designed phone FAQ screen; `pub-landing` is the closest approved phone shell/step reference.

Existing mockup differences remain as approved in DECISIONS.md: three removed section eyebrows, retained full step explanations on phone, revised tradie wording, and the explicit Example reviews label. Those are already on main and are not changes in this issue.

## Default rendering and words

A controlled comparison in the same loaded production page restores the original `overflow-wrap: normal` values on exactly the three affected scopes, captures, removes that override, then captures the fixed CSS. **Zero changed pixels** across the entire default page at both **1440 × 4251** and **390 × 4623**. See `original-css-*`, `fixed-css-*`, `default-pixel-comparison.json` and `original-css-proof.json`. Separate browser captures can differ as responsive images or icon fonts load; that is why the controlled comparison is the default-pixel evidence.

| Main-content words | Original | Fixed, pass 1 | Fixed, pass 2 |
|---|---:|---:|---:|
| 1440px | 309 | 309 | 309 |
| 390px | 293 | 293 | 293 |

Counts include all scrollable main content and all category rail items, with the first FAQ answer open; exclude shared header/footer, icon ligatures, decorative aria-hidden illustration, inert FAQ answers and the visually hidden phone how heading. Numbers and hyphenated/apostrophe words count as single tokens. Exact visible main text is unchanged in the controlled original/fixed comparison. No product copy was added or removed.

## Validation

- `npm run lint`: passed, no warnings in final run.
- `npm run typecheck`: passed.
- `npm test -- --maxWorkers=1`: 104 files, **2,191 passed**, zero skipped; task-owned disposable PostgreSQL 17 on localhost, isolated per-file schemas.
- `npm run build`: passed; local temporary Next CPU cap of two was restored afterward and is not a product change.
- Focused production `landing-text-resize.spec.ts`: **6 passed**. Covers 320/390/640/768/1024/1440, default and 200% text, text-line bounds in each step/FAQ/promise area, exact unchanged main text, keyboard FAQ expansion, page overflow and axe.
- Full production e2e: **193 passed, 425 existing conditional skips, zero failures**; all six new tests run without skips. Results are in `checks.json` and `production-e2e.txt`. Its temporary config changes only the owned port/output paths, installed Chrome executable and worker count; all repository tests/guards/assertions remain intact. The first full attempt could not start because moving the temporary config changed the default server working directory; setting the checkout cwd corrected this harness error before tests ran.

Heavy checks run serially under the owned atomic `/tmp/trade-marketplace-heavy-check.lock`, capped at two workers (one for the database unit suite, matching CI). Local Node 22.23.4 and installed Google Chrome are used. No live database/Supabase, credentials or service settings are changed. No merge or manual deployment.

Signed-out real-browser journey: typed “Fix the gate” on the homepage and submitted with Enter, clicked Sign up on login, clicked Next into customer details, and used browser Back. Every destination retains `/jobs/new?description=Fix+the+gate&location=Invercargill`. No account was submitted.
