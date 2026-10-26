# Testing

Three kinds of test, all in `tests/`:

| Kind | Command | Where | Tool |
|---|---|---|---|
| Unit | `npm test` | `tests/unit/*.test.ts(x)` | [Vitest](https://vitest.dev) |
| End-to-end | `npm run e2e` | `tests/e2e/*.spec.ts` | [Playwright](https://playwright.dev) |
| Accessibility | part of `npm run e2e` | inside e2e tests | [axe](https://github.com/dequelabs/axe-core) via `expectNoA11yViolations` |

Every PR runs `npm run lint`, `npm run typecheck`, `npm test` and `npm run build` (AGENTS.md §3). Run `npm run e2e`
too whenever you change a screen. CI (`.github/workflows/ci.yml`) runs all of them, e2e last on the app it just built.
When an e2e test fails there, the run's **Artifacts** has `playwright-report` (kept 7 days): download it and open
`index.html` to see each failure with its screenshot and trace.

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

**Unit tests (now).** Nothing talks to Supabase. Pick who is signed in by handing the code a fake:

- **Guards** (`requireRole`, `withRole`, `withRoleRoute`): `createGuards(async () => viewer)` with a `Viewer` of the
  role you want, or `null` for signed out / session expired. See `tests/unit/auth-guard.test.ts`.
- **The proxy**: `refreshSession(request, { readUserId, findRole })` with a `NextRequest` and fake sources. See
  `tests/unit/auth-refresh.test.ts`, which also runs the real `@supabase/ssr` client against a stubbed `fetch` to
  prove an expired token is refreshed and set as an http-only cookie.
- **Sign up / log in**: `signUp()` / `logIn()` from `src/server/auth/account.ts` take a fake Supabase `auth` object
  and a profile store (`tests/unit/auth-account.test.ts`). With `TEST_DATABASE_URL` set,
  `tests/unit/auth-profiles.test.ts` does the same against the real `profiles` table (insert into `auth.users` first,
  as Supabase would).
- **Server Components**: mock `@/server/auth/viewer` and set what `getViewer()` returns (`tests/unit/layout.test.tsx`).

**End-to-end tests (later).** E2E runs keep Supabase off (`playwright.config.ts`), so everyone is signed out and
`tests/e2e/route-protection.spec.ts` only checks the signed-out redirect. Signed-in e2e tests need a throwaway
Supabase Auth to sign in against (a local `supabase start`, or the staging project from #89, never the real one) and
the seeded demo accounts (see "Seed data" below: seed that Supabase with `SUPABASE_SECRET_KEY` and
`SEED_DEMO_PASSWORD` set, so the accounts really log in). Then add a fixture in `tests/e2e/support/` that logs in once
per role (`customer@`, `tradie@`, `worker@`, `office@demo.test`, password from `SEED_DEMO_PASSWORD`) through the
log-in page (#102), saves the session with Playwright's `storageState`, and lets tests start signed in:
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

End-to-end runs start the app with `DATABASE_URL`, `DIRECT_URL` and the Supabase variables blank (see
`playwright.config.ts`), so tests can never touch the real Supabase project (docs/SERVICES.md).

Database tests never share data with each other:

- **Never the real project.** Tests use a throwaway Postgres named by `TEST_DATABASE_URL`: a local Docker `postgres`
  in development and a service container in CI. It never falls back to `DATABASE_URL`. Without it, database tests
  are skipped with a message locally and fail in CI.

  ```bash
  docker run --rm -d -p 54329:5432 -e POSTGRES_PASSWORD=postgres postgres:17
  TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:54329/postgres npm test
  ```

- **Unit and integration tests (Vitest): one schema per test file.** `useTestSchema()` (`tests/support/test-db.ts`)
  creates a schema named after the file and worker (e.g. `test_schema_people_3_a1b2c3`), runs
  `prisma migrate deploy` into it, gives you a Prisma client for it, and drops it afterwards. Files run in parallel
  without seeing each other's rows. See `tests/unit/schema-people.test.ts`:

  ```ts
  describe.skipIf(!testDatabaseUrl)("jobs", () => {
    const schema = useTestSchema(import.meta.filename);
    it("…", async () => {
      await schema.db.profile.findMany();
    });
  });
  ```

  A plain Postgres has no Supabase `auth` schema, so the first migration creates small stand-ins (`auth.users`,
  `auth.uid()`). Make a person by inserting into `auth.users` first, then their profile. To test row-level security,
  switch to a role without the owner's bypass and set `request.jwt.claims`, like the `asSignedIn` helper does.
- **End-to-end tests (Playwright): seed once, then each test makes its own rows.** A `globalSetup` migrates the test
  database and runs `npm run db:seed` with `ALLOW_SEED=1` (demo accounts and a job in every status, #88). Tests that change data create
  their own job with a unique name rather than editing a shared seeded one, so parallel tests don't collide.

## Seed data

`npm run db:seed` (`prisma/seed.mjs`, #88) fills a local or preview database with demo data. It is safe to run again:
a second run leaves exactly the same rows (same ids, same TM numbers), and rows that aren't demo data are left alone.

```bash
# A local Postgres, migrated first (npm run db:migrate, or npx prisma migrate deploy):
ALLOW_SEED=1 DIRECT_URL=postgresql://postgres:postgres@localhost:5432/tm_local \
  DATABASE_URL=postgresql://postgres:postgres@localhost:5432/tm_local npm run db:seed
```

**What it makes** (`prisma/seed/data.mjs`; every name, address and figure is an example):

| Account | Role | What it's for |
|---|---|---|
| `customer@demo.test` | Customer | Posted every demo job. Two saved places in Invercargill (Home, Rental). |
| `tradie@demo.test` | Tradie | Electrical, licence `VERIFIED`, verified badge, available. |
| `worker@demo.test` | Tradie | Other work only, not verified (no badge), available. |
| `office@demo.test` | Office (`ADMIN`) | Priced the jobs, checked the licence. |

Ten jobs (TM-1001 onwards on a fresh database), at least one in every status (`REVIEW`, `QUOTE_BOUNTY`, `PRICED`,
`BOOKABLE`, `ASSIGNED`, `SUBMITTED`, `COMPLETED`, `CANCEL_REVIEW`, `CANCELLED`) and every trade, each with photos,
and with time windows, blind estimates, example pricing rows, a worker and a booked window where its status would
have them. Each job is posted as `REVIEW` and moved through its statuses by the person who'd do it, so the database
triggers write a real status history and check every job rule. Time windows are days from the day you seed, so
previews always show upcoming ones. "Assigned with extra work" and payments/payouts need Schema 3 (#91) and are a
follow-up.

**Photos.** Uploads (#96) aren't built yet, so `job_photos.path` holds `demo/<file>` and the small files live in
`prisma/seed/photos/` (a few KB each). The uploads task should send each file to that path in the photos bucket.

**Sign-ins.** Every demo profile needs a Supabase Auth user, and the seed picks how to make them from the environment:

- **Plain Postgres** (local, CI): rows go straight into the migration's stand-in `auth.users`. There's no Supabase
  Auth to log in against, so nobody can log in; it's for database tests and local development.
- **A Supabase project** (preview/staging #89, or a local `supabase start`): set `NEXT_PUBLIC_SUPABASE_URL`,
  `SUPABASE_SECRET_KEY` (server-only, `sb_secret_…`) and `SEED_DEMO_PASSWORD` for that project. Users are made (or
  updated) through the Supabase Auth admin API, email confirmed, so the demo accounts log in with
  `SEED_DEMO_PASSWORD`. The password is never in the repo; keep it in the password manager.

**When it refuses.** It writes nothing and lists every reason unless **all** of these hold:

1. `ALLOW_SEED=1` is set.
2. Every database URL set (`DIRECT_URL`, `DATABASE_URL`) is local (`localhost`, `127.0.0.1`, `::1`), or its database
   name contains `preview` or `local`, or it's a Supabase project whose ref can be read from the URL and isn't
   production. (Supabase database names are always `postgres`, so the ref comes from the host `db.<ref>.supabase.co`
   or the pooler user name `postgres.<ref>`.)
3. The production project ref (`bwbwbpnqfxjdkbompsvg`, docs/SERVICES.md) appears in none of the database or Supabase
   URLs.
4. On a Supabase database, the Auth keys above are set and name the same project (rows without a password in the
   real `auth.users` would be accounts nobody can use). The seed also checks the database itself: a real Supabase
   `auth.users` without the keys is refused.

Tests: `tests/unit/seed-guard.test.ts` (refusal rules) and `tests/unit/seed.test.ts` (seeding twice gives the same rows,
every status and trade, sign-ins through a fake Supabase admin API, no committed password).
