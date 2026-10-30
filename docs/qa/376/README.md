# Category text enlargement — #376

**Blocked on hosted e2e:** [homepage overflow #404](https://github.com/trade-marketplace/main/issues/404). The category containment assertion passes, but the unchanged homepage FAQ and step grids overflow at 320px with 200% text. The page-wide assertion remains enabled.

Chromium, local app with database and Supabase disabled. No product copy changed: the five category names and their sublabels contain 16 words in both the reference and build, including offscreen rail items. The phone initially shows six complete words; the remaining cards are reached by horizontal scrolling or Tab.

Both visual passes were personally inspected. Each default pair has the mockup on the left and the build on the right, with equally sized panels: 1440 × 220 or 390 × 220. The desktop source is `pages.html#w-landing`; the phone source is the shared category kit in `screens.html#cus-home`. `pages.html#w-c-home` was also inspected before coding. These are category crops, not full-page match claims. The phone reference has its existing customer-home surroundings; the build is the existing public homepage.

| View | First inspection | Second inspection |
|---|---|---|
| Desktop | [1440 pair](default-1440-pass-1.png) | [1440 pair](default-1440-pass-2.png) |
| Phone | [390 pair](default-390-pass-1.png) | [390 pair](default-390-pass-2.png) |

Default cards remain 159 × 162 with 15px category names. Artwork, fonts, colours, radii, shadows, rail spacing and labels are preserved. At a 200% root font, cards with two-line names grow to 230.39px and Other to 194.39px, with 8px below each sublabel. See [measurements](measurements.json).

- [Original failure / corrected build](before-after-640.png): two 640 × 900 browser screenshots at 200% root font, before on the left. Browser-selected scroll positions differ because the corrected cards are taller.
- [Corrected category rail at a 640 × 900 viewport and 200% root font](enlarged-640.png). The rail crop includes the first cards; horizontally scrolling reveals the rest.
- [Shared kit at 200%, including the disabled Plumbing reason](disabled-200.png).

The focused browser tests cover default and 200% text at 320, 390, 640, 768, 1024 and 1440, containment of names and sublabels, unchanged default dimensions, horizontal rail access, no page overflow, category-scoped axe, keyboard focus and the job-start/login return journey. The guarded local kit also covers disabled reasons and long unbroken sublabels in customer, trade and office modes.

No new loading/error state is introduced: this is the existing static category card's sizing fix. Database-backed checks require the separate disposable test database; no live connection is used.

## Original local validation and hosted correction

- Lint and typecheck: passed.
- Unit suite: 1,939 passed, 252 skipped; 96 files passed and 8 database-dependent files skipped.
- Production build: passed.
- Original local production Chromium suite reported 194 passed and 426 opt-in checks skipped (620 discovered), two workers, unique port 3377. This is superseded by the hosted failure below.
- The earlier local category suite reported 8 passed, including guarded disabled/long-sublabel fixtures; root text-size checks have since been strengthened. The hardened production category rerun has 6 passed, 1 guarded fixture skipped and 1 failed: the unchanged 320px page-overflow assertion receives 66 after confirming a 32px root font and passing category containment.
- Full e2e used Node 22.23.4, within the supported Node 22 range. The host's older Node 22.17 failed in dependency test discovery before tests could run.
- Hosted [CI job 123833078271](https://github.com/trade-marketplace/main/actions/runs/40984764042/job/123833078271): lint, typecheck, database-backed unit tests and build passed. E2e had 193 passed, 426 skipped and one failure on both attempts: expected page overflow 0, received 65 at 320px/200%. See the [hosted screenshot](hosted-320-200-overflow.png).
- The earlier transient-overflow explanation was incorrect. Hydration could reset a premature inline root-font mutation to 16px and produce a false local pass. The test now waits for header hydration and asserts the computed root font stays doubled; no containment, page-overflow, rail, keyboard or axe assertion was removed or weakened.
- With hydration complete, loaded fonts and a verified 32px root font, local diagnosis finds 66px overflow. The FAQ grid extends from x=20 to x=385.92; the last step extends to x=338.81. Restoring the original category CSS leaves the same overflow. These unchanged homepage rules are outside #376's assigned card scope and are tracked in #404. No unrelated homepage change or rule suppression was made.

The 426 production skips are the suite's guarded development fixtures and opt-in isolated authentication/database checks. The category kit fixture relevant to this fix was tested separately above. No live Supabase or database was contacted. Heavy checks used the owned shared atomic lock, released on exit.
