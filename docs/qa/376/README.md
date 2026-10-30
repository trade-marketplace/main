# Category text enlargement — #376

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

## Final validation

- Lint and typecheck: passed.
- Unit suite: 1,939 passed, 252 skipped; 96 files passed and 8 database-dependent files skipped.
- Production build: passed.
- Full production Chromium suite: 194 passed, 426 opt-in checks skipped (620 discovered), two workers, unique port 3377.
- Focused local category suite: 8 passed, including guarded disabled/long-sublabel fixtures.
- Full e2e used Node 22.23.4, within the supported Node 22 range. The host's older Node 22.17 failed in dependency test discovery before tests could run.
- The text-size test waits for font/layout selection after changing the root font. An initial immediate assertion observed transient 320px overflow; the settled baseline and fixed styles both measured zero. No unrelated homepage change or rule suppression was made.

The 426 production skips are the suite's guarded development fixtures and opt-in isolated authentication/database checks. The category kit fixture relevant to this fix was tested separately above. No live Supabase or database was contacted. Heavy checks used the owned shared atomic lock, released on exit.
