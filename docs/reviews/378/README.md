# Signup navigation review — #378

29 October 2026. Baseline: main 732fa1a. Chromium screenshots at native 1440×900 and 390×844. The original desktop/phone mockups were opened in Chromium before changes. Two capture-and-review passes compared every before/after pair. Home, choose, customer, tradie account and trade-details captures are pixel-identical to the baseline in both passes. Existing approved differences from the older mockups are retained as Matt requested; this change does not redesign or rewrite those screens.

## Confirmed failures

- Homepage **Join as a tradie** opened `/for-tradies`, which is unbuilt (#213), and displayed 404. It now opens `/signup/tradie`, sharing the footer Join route constant.
- The phone menu closed on a blur with `relatedTarget: null` before its link received a click. Chromium reproduced this with the browser's active element blurred during pointerdown; WebKit reproduced it without emulation too. Keeping null-target focus changes separate from outside-pointer dismissal lets the link activate. Escape, Tab outside, outside clicks and desktop resize retain their dismissal behaviour.
- Fresh anonymous live-browser checks found header signup, footer Join and the role-choice Next route correct outside that menu failure. No auth policy changes were needed.

## Before | after

Each image preserves both screens at their original dimensions. Only the route-destination captures change.

| Screen / journey | 1440 | 390 |
|---|---|---|
| Home | [Pair](home-pair-after2-1440.png) | [Pair](home-pair-after2-390.png) |
| Join as a tradie destination | [404 → tradie signup](cta-pair-after2-1440.png) | [404 → tradie signup](cta-pair-after2-390.png) |
| Choose role | [Pair](choice-pair-after2-1440.png) | [Pair](choice-pair-after2-390.png) |
| Customer details | [Pair](customer-pair-after2-1440.png) | [Pair](customer-pair-after2-390.png) |
| Tradie account | [Pair](tradie-pair-after2-1440.png) | [Pair](tradie-pair-after2-390.png) |
| Your trade | [Pair](trade-step-pair-after2-1440.png) | [Pair](trade-step-pair-after2-390.png) |
| Menu signup click with null-target blur | — | [Home → signup](menu-click-pair-after2-390.png) |

## Mockup | built context

These are historical design references, not a request to undo approved copy or signup decisions. The tradie reference shows the trade-details step; the built tradie account capture precedes it. The corresponding unchanged trade-details capture is linked above.

| Reference | 1440 | 390 |
|---|---|---|
| Home | [Pair](home-mockup-pair-after2-1440.png) | [Pair](home-mockup-pair-after2-390.png) |
| Choose | [Pair](choice-mockup-pair-after2-1440.png) | [Pair](choice-mockup-pair-after2-390.png) |
| Customer | [Pair](customer-mockup-pair-after2-1440.png) | [Pair](customer-mockup-pair-after2-390.png) |
| Tradie | [Pair](tradie-mockup-pair-after2-1440.png) | [Pair](tradie-mockup-pair-after2-390.png) |

## Word counts

Visible page text, including off-screen content and empty-field placeholders; icon ligatures, hidden labels and development tools excluded. Measured at rest. These are QA measurements, not cutting targets. **No product words were removed, shortened or added.**

| Screen | 1440 before → after | 390 before → after |
|---|---|---|
| Home | 389 → 389 | 348 → 348 |
| Choose role | 24 → 24 | 20 → 20 |
| Customer details | 46 → 46 | 34 → 34 |
| Tradie account | 43 → 43 | 27 → 27 |
| Your trade | 73 → 73 | 65 → 65 |

CTA destination counts change from 404 (57/49) to tradie signup (43/27); menu-click destination changes from home (348) to choose (20). Those changes reflect corrected navigation, not copy edits.

## Reused components and tokens

Existing Button/IconButton, Icon, Wordmark, SiteShell/SiteHeader/SiteFooter, AuthLayout, SignupChoice/SignupRoleChoices, SignupDetails, TextField/PasswordField and choice fields. The existing kit also provides cards, status, overlays, feedback, data, media, map, app and office shells. No new component style, font, colour, icon or animation was introduced. Existing `src/styles/tokens.css` supplies Trade Display/Trade UI, Material Symbols Rounded, Forest/Leaf/Lime and Hi-Vis/Amber modes, spacing, typography, field, radius, shadow and focus tokens. Click/tap focus continues to use shared FocusVisibility; keyboard M05 remains visible.

## Verification

Actual navigation at 320/390/768/1024/1440: header/menu Sign up, customer/tradie selection, Next, browser Back, Join CTA, footer Join, tradie Next/Back with retained fields, return paths, null-target blur, outside-click/Tab/Escape dismissal and touch activation. Chromium and WebKit run the same journey tests (WebKit on macOS uses Option-Tab to reach all controls with default keyboard-access settings).

All checks run with database/Supabase disabled. No live database queries or writes, accounts, emails or production form submissions. Optional database and guarded preview suites are reported separately from the standard suite.

The For tradies informational link still belongs to #213; it is separate from signup. The founder was asked on #378 whether that planned information link should temporarily route to signup. The confirmed signup fixes proceed without inventing that rule.

Results: lint and typecheck passed; unit tests 1,798 passed / 252 optional database tests skipped; production build passed; standard end-to-end tests 170 passed / 387 guarded preview tests skipped. The dedicated browser journey run passed 52/52 (26 Chromium, 26 WebKit), including touch at all five widths. The published tree must match the checked local tree.
