# Testing

Three kinds of test, all in `tests/`:

| Kind | Command | Where | Tool |
|---|---|---|---|
| Unit | `npm test` | `tests/unit/*.test.ts(x)` | [Vitest](https://vitest.dev) |
| End-to-end | `npm run e2e` | `tests/e2e/*.spec.ts` | [Playwright](https://playwright.dev) |
| Accessibility | part of `npm run e2e` | inside e2e tests | [axe](https://github.com/dequelabs/axe-core) via `expectNoA11yViolations` |

Every PR runs `npm run lint`, `npm run typecheck`, `npm test` and `npm run build` (AGENTS.md §3). Run `npm run e2e`
too whenever you change a screen.

## Unit tests (Vitest)

For logic without a browser: job status rules, pricing maths, who-sees-what, env parsing, formatting.

- One file per module, named after it: `src/server/env.ts` → `tests/unit/env.test.ts`.
- Import app code with the `@/` alias: `import { parseEnv } from "@/server/env"`. Files that start with
  `import "server-only"` work in tests (`vitest.config.ts` swaps in a stub).
- Cover the main path **and every "What if…" case in the issue**, one `it(...)` each, named in plain words.
- No network and no real database. Pass fakes in, or test the pure function that the database code calls.
- Simple React components can be checked with `renderToString` (see `tests/unit/home.test.tsx`). Anything that needs
  clicks, focus or real layout belongs in an end-to-end test.

```ts
import { describe, expect, it } from "vitest";

import { parseEnv } from "@/server/env";

describe("parseEnv", () => {
  it("treats an empty DATABASE_URL as unset", () => {
    expect(parseEnv({ DATABASE_URL: "" }).database).toEqual({ enabled: false });
  });
});
```

Run one file: `npx vitest run tests/unit/env.test.ts`. Watch mode while you work: `npx vitest`.

## End-to-end tests (Playwright)

For what a person does in the browser: open a page, fill a form, see the right state.

`npm run e2e` builds the app (`npm run build`), then Playwright starts it with `next start` on port 3100 and runs
every `tests/e2e/*.spec.ts` in Chromium. Settings are in `playwright.config.ts`.

- **First time on a new machine:** `npx playwright install chromium` downloads the browser. If you already have a
  Chromium somewhere else, point at it instead: `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chrome npm run e2e`.
- **Already built?** Skip the build: `npx playwright test` (or one file: `npx playwright test tests/e2e/home.spec.ts`).
- **See what's happening:** `npx playwright test --ui`, or `--headed`. A failing test keeps a trace in
  `test-results/`; open it with `npx playwright show-trace <path>/trace.zip`.

How to write one:

- Find things the way a person or screen reader would: `page.getByRole("button", { name: "Post job" })`,
  `getByLabel`, `getByText`. Avoid CSS selectors and test IDs unless there's no accessible name.
- Use web-first assertions that wait: `await expect(locator).toBeVisible()`, never fixed sleeps.
- Check every screen at the widths in `tests/e2e/support/viewports.ts` (320, 390, 768, 1024, 1440) and include
  "has no sideways scroll". Loop over `VIEWPORTS` like `tests/e2e/home.spec.ts` does.
- Build each state the design lists (loading, empty, error, success…) and test each one.
- Each test sets up what it needs and doesn't depend on another test having run first. Tests run in parallel.
- Prices, names and counts in the mockups are examples. Assert on what the server returns, not mockup numbers.

```ts
import { expect, test } from "@playwright/test";

import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

for (const viewport of VIEWPORTS) {
  test.describe(`post a job at ${viewport.width}px`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("shows the empty state", async ({ page }) => {
      await page.goto("/jobs");
      await expect(page.getByRole("heading", { name: "No jobs yet" })).toBeVisible();
      await expectNoA11yViolations(page);
    });
  });
}
```

### Signing in as a role

Not possible yet: sign-in (Supabase Auth) arrives in #101/#102. When it does, add a fixture in
`tests/e2e/support/` that signs in as a seeded customer, tradie or office user once, saves the session with
Playwright's `storageState`, and lets tests start already signed in:
`test.use({ storageState: "tests/e2e/.auth/customer.json" })` (`.auth/` must stay out of git).

## Accessibility checks (axe)

`expectNoA11yViolations(page)` (`tests/e2e/support/a11y.ts`) runs every axe rule (WCAG 2.0–2.2 A and AA plus axe's
best practices) on the page as it is now and **fails the test on any violation**, listing the rule, how serious it
is, a link explaining the fix, and the element.

- Call it in every e2e test of a screen, at every width, and again after anything that changes the page (a dialog
  opens, an error shows, a list fills). Only check one part with `{ include: "[role=dialog]" }`.
- Something we don't control (e.g. the Mapbox canvas) can be skipped with `{ exclude: [".mapboxgl-canvas"] }`.
- Turning a rule off needs a reason and Matt's review, because it hides a problem rather than fixing it:
  `{ disableRules: [{ id: "color-contrast", reason: "…" }] }`.
- axe catches roughly a third of accessibility problems. Still check keyboard use (Tab through it, see the focus)
  and a screen reader by hand (AGENTS.md §3).

`tests/e2e/a11y-helper.spec.ts` proves the helper really fails on a broken page, so keep it passing.

## Databases in tests

There are no database tests yet: the schema arrives in #86 and seed data in #88. End-to-end runs start the app with
`DATABASE_URL`, `DIRECT_URL` and the Supabase variables blank (see `playwright.config.ts`), so tests can never touch
the real Supabase project (docs/SERVICES.md).

When database tests arrive, they must not share data with each other:

- **Never the real project.** Tests use a throwaway Postgres: a local Docker `postgres` in development and a service
  container in CI, with its own `TEST_DATABASE_URL`. A test that finds no test database skips with a clear message;
  it never falls back to `DATABASE_URL`.
- **Unit and integration tests (Vitest): one schema per test file.** A setup file creates a schema named after the
  file and worker (e.g. `test_jobs_3`), runs `prisma migrate deploy` against it (`?schema=` in the URL), and drops it
  afterwards. Files then run in parallel without seeing each other's rows. Inside a file, a test that only reads and
  writes can instead run in a transaction that is rolled back at the end.
- **End-to-end tests (Playwright): seed once, then each test makes its own rows.** A `globalSetup` migrates the test
  database and runs `npm run db:seed` (demo accounts and a job in every status, #88). Tests that change data create
  their own job with a unique name rather than editing a shared seeded one, so parallel tests don't collide.
