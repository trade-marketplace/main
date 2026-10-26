# Architecture

A single Next.js app (App Router, TypeScript strict) on **Vercel**, with **Supabase Postgres** through Prisma. Both
run in **Sydney** (`vercel.json` pins functions to `syd1`). See DECISIONS.md (#58).

## Folder layout

| Folder | What goes there |
|---|---|
| `src/app/` | Routes: pages, layouts, route handlers, server actions. Keep them thin; call into `src/server`. Actions shared by several pages (e.g. sign-in) can live in a `"use server"` file in `src/server`. |
| `src/components/` | UI components. Built from the design kit (`docs/design/`), tokens only, no hard-coded hex. |
| `src/server/` | Server-only logic: database access, job status rules, pricing, who-sees-what. Files that touch secrets or the database start with `import "server-only"`, so they can never end up in browser code. |
| `src/lib/` | Small helpers safe on both server and browser (formatting, shared types). No secrets, no database. |
| `src/proxy.ts` | Runs before every request: session refresh and role redirects (see "Sign-in, sessions and roles"). |
| `src/generated/` | The generated Prisma client. Not committed; `npm install` and `npm run build` rebuild it. |
| `prisma/` | `schema.prisma`, migrations and the seed script. Schema changes need William's review. |
| `tests/` | Tests. `tests/unit/` runs with `npm test` (Vitest); `tests/e2e/` with `npm run e2e` (Playwright + axe). How to write them: [TESTING.md](TESTING.md). |
| `scripts/` | Command-line helpers run by npm scripts. |

Import from `src` with the `@/` alias, e.g. `import { getDb } from "@/server/db"`.

## Environment and the database

- Every variable is listed with a comment in `.env.example`. Copy it to `.env.local`; never commit that file.
- `src/server/env.ts` checks the variables when the app starts or builds, and stops with a clear message if one is set
  up wrong.
- The database is **optional** until the Supabase project's keys are shared. With no `DATABASE_URL` the app still
  builds and runs. `getDb()` (`src/server/db.ts`) only connects on first use, and explains how to connect if it can't.
- When `npm run dev` starts, `src/instrumentation.ts` checks whether the database can be reached and prints
  what to do if it can't, instead of a stack trace.
- `DATABASE_URL` is Supabase's pooled connection (used by the app); `DIRECT_URL` is the direct one (used by
  `npm run db:migrate`).

## Supabase client and sign-in

Sign-in uses **Supabase Auth** (DECISIONS.md, #60); files go in **Supabase Storage** (#59). The prototype's
jose/bcrypt sessions are not ported.

- `createSupabaseServerClient()` (`src/server/supabase.ts`) is for Server Components, Server Actions and Route
  Handlers. It acts as the signed-in visitor through their cookies.
- `createSupabaseBrowserClient()` (`src/lib/supabase/browser.ts`) is for Client Components. The session cookies are
  http-only, so it can't see the session and always runs **signed out**: anything that needs the user goes through
  our server (an action or route handler).
- Both are optional like the database: until `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
  are set they throw an error that says how to connect, and the app runs with everyone signed out.

## Sign-in, sessions and roles (#101)

| Piece | Where | What it does |
|---|---|---|
| Who may open what | `src/lib/auth/routes.ts` | The route table (from `docs/design/sitemap.json`), each role's home, `?next=` handling. Pure; shared by the proxy and log-in. |
| Proxy | `src/proxy.ts` → `src/server/auth/refresh.ts` | Runs before every request (Next 16 renamed `middleware.ts` to `proxy.ts`). Refreshes the session, then redirects page visits. |
| Who is signed in | `src/server/auth/viewer.ts` | `getViewer()`: the verified Supabase user + their `profiles` row, cached per request. Null when signed out. |
| Role checks | `src/server/auth/guard.ts` | `requireRole()` / `requireUser()` for pages, `withRole()` for server actions, `withRoleRoute()` for route handlers. |
| Sign up, log in, log out | `src/server/auth/actions.ts` (actions), `src/server/auth/account.ts` (logic) | Server actions the pages (#102–#105) and the session-expired dialog (#108) call. |
| Password rules | `src/lib/auth/password.ts` | 10+ characters, at most 72 bytes, not on the bundled common list, not the email. Shared by browser and server. |

**Homes.** Customer `/`, tradie `/jobs`, office `/admin`. After log-in people go back to `?next=` if their role may
open it, else home. `?next=` only ever holds a path on this site (`safeNextPath()`), so log-in can't bounce anyone to
another website.

**Route rules.** Public pages (marketing, help, legal, verify, recovery, anything not in the table) are open to all.
`/login` and `/signup*` send a signed-in person home. `/` is the landing page signed out and the customer home signed
in, so tradies and office users are sent to their own home. Every other app page lists the roles that may open it:
signed out → `/login?next=…`; wrong role (e.g. a tradie on `/jobs/new`) → their home. To protect a new page, add it
to `RULES` in `routes.ts` with a test in `tests/unit/auth-routes.test.ts`.

**The role always comes from `profiles`**, read on the server by user id after Supabase has verified the session
(`getClaims()` checks the token's signature). Never from a cookie, a form field, a header or Supabase user metadata,
which the user can edit. Sign-up only offers CUSTOMER or TRADIE; ADMIN is set by a founder in the database.

**Every page, action and route handler checks the role itself.** The proxy is only the first line (Next.js warns
that a matcher change or a moved action silently drops it). `tests/unit/auth-every-action.test.ts` fails if a
`"use server"` file exports an action that isn't built with `withRole()`, apart from the sign-in actions.

```ts
// src/app/jobs/new/page.tsx
const viewer = await requireRole(["CUSTOMER"], { next: "/jobs/new" });

// src/server/jobs/actions.ts ("use server")
export const postJob = withRole(["CUSTOMER"], async (viewer, _previous: PostJobState, formData: FormData) => { … });

// src/app/api/jobs/[id]/photos/route.ts
export const POST = withRoleRoute(["CUSTOMER"], async (viewer, request) => { … });
```

**Session refresh.** An access token lasts an hour. The proxy calls `getClaims()` on every request, which swaps an
expired token for a new pair; the new cookies go on the request (so the page rendering next sees them) and on the
response (so the browser keeps them), including on a redirect. Server Components can't set cookies, which is why
the refresh happens in the proxy. The proxy reads `profiles` only for non-public pages, so public pages cost no
database read.

**Cookies** (`authCookieOptions()` in `src/server/supabase.ts`): `HttpOnly`, `Secure` (except `next dev` on plain
http), `SameSite=Lax`, path `/`. Supabase decides when a session ends, not the cookie. "Keep me logged in" (30 days
vs browser session) is the log-in page's (#102).

**CSRF.** Forms post to **server actions**, never to GET links or our own POST endpoints. That's safe without a
token because (1) Next.js only runs an action on POST and refuses one whose `Origin` header doesn't match the host,
and (2) the session cookies are `SameSite=Lax`, so the browser doesn't send them on a cross-site POST at all.
Route handlers get neither check from Next.js, so `withRoleRoute()` refuses a write (POST/PUT/PATCH/DELETE) whose
`Origin` isn't this site. Log out is a form with `action={logOutAction}`, never a link.

**Session expired mid-form (B07).** A protected action never redirects when the session has gone; `withRole()`
returns `{ ok: false, error: "session-expired", values }` instead (`src/lib/auth/results.ts`), where `values` are
the form's text fields (never passwords or files). The proxy also never redirects a server action (a POST with a
`Next-Action` header), so the action always gets to answer. Wrong role is `{ ok: false, error: "forbidden" }`.
Route handlers answer 401 `{ error: "session-expired" }` / 403 `{ error: "forbidden" }`.

How the dialog (#108) hooks in:

1. A form uses `useActionState(action, …)`. When the state passes `isSessionExpired(state)`, render the dialog over
   the page. Don't navigate: the page and its client state stay as they are.
2. Keep the fields filled: React resets a `<form action>` after it's sent, so give each field
   `defaultValue={state?.values?.title ?? …}` (or keep the fields controlled, or keep a draft in `sessionStorage`).
3. The dialog's form posts to `logInAgainAction` (same fields as log-in), which answers `{ ok: true, role }` without
   redirecting. Then call `router.refresh()` and send the original form again (`form.requestSubmit()`).
4. If someone else logs in in the dialog, the resubmitted action runs as them and their role is checked again.

**Sign-up creates the profile.** `signUpAction` calls Supabase `signUp()` and then creates the `profiles` row with
Prisma straight away. What they chose (name, role) is also kept in Supabase's user metadata, so if saving the
profile fails, their first log-in creates it (`ensureProfile()`, CUSTOMER or TRADIE only). Log-in also copies
Supabase's email confirmation time to `profiles.email_verified_at`. A Supabase user with no profile counts as signed
out until then.

**Not here yet:** the log-in and sign-up pages (#102–#105), the verify-email link handler (#106), password reset
(#107), the dialog (#108), lockout after 5 tries (#102), log out other devices (#113).

**Supabase project settings** (William, in the dashboard; nothing in this repo changes them): Authentication →
Providers → Email: minimum password length **10**; leaked-password protection once on Pro. Whether email must be
confirmed before log-in is a project setting too (#102 wants log-in to work with a "please verify" banner).

## Data model

`prisma/schema.prisma` is the map: every model has a comment saying what it holds and who may see it. Changes are
Prisma migrations in `prisma/migrations/` (William reviews). What Prisma's schema can't express (row-level security,
checks, triggers) is hand-written SQL at the end of the same migration, under a clear divider.

- **People (Schema 1, #86).** `profiles` has one row per Supabase Auth user (same id). Supabase Auth owns passwords
  and sessions ("log out other devices" is Supabase's), so there is no sessions table. Workers add
  `worker_profiles`, `worker_trades` (several per worker, incl. `OTHER`) and `licences` (one per worker per licensed
  trade, its own status). Customers' saved places are `addresses`. Bank and tax details are in `payroll_details`.
- **Jobs (Schema 2, #87).** `jobs` (TM-1001 onwards, category = the `trade` enum, status incl. `QUOTE_BOUNTY`, the
  customer's price in `price_cents`, the booked window) with `job_photos`, `job_time_windows` (date × morning /
  afternoon / evening, or `any_time` on the job), blind `estimates` (one per worker per job; time in minutes) and
  `job_status_history`. How a price was built (rates copied from settings, worker pay, margin) is in `job_pricing`.
  Money is whole cents, percentages basis points.
- **Job rules live in the database.** Triggers write a status history row on every insert and status change (the
  server names the actor with `SET LOCAL app.actor_id`), set `edited_at` when the job's content or photos change
  and flag older estimates `made_before_edit` (cleared when the worker saves again), freeze `price_cents` and
  `job_pricing` once the job is paid, and only allow booking a window the customer offered.
- **Money (Schema 3, #91).** A job can have several `payments` (`JOB`, `VARIATION` for extra work, `QUICK_LOOK`
  for the $30 look), each with Stripe's ids, a unique idempotency key, `livemode` (false in test mode) and
  `refunded_cents` for full and partial refunds. Extra work is `variations` (REQUESTED → PRICED → APPROVED |
  DECLINED: the worker's ask, then the office's figures built like `job_pricing` with the job's frozen rates).
  `payouts` are one per worker per job (crews later), QUEUED → EXPORTED → PAID, records for payroll rather than
  transfers. `job_materials` holds the budget and actual spend, at cost ex GST.
- **Settings.** `settings` has exactly one row (`id` = 1), made by the migration with the launch rates (#62):
  `shared_rate_cents` 7000 (every licensed trade) and `other_rate_cents` 3800, `shared_min_minutes` 120 /
  `other_min_minutes` 60, holiday pay 8%, on-costs 12.5%, margin 20%, GST 15% (basis points), `auto_release_hours`
  48, `quick_look_price_cents` 3000, `bounty_expiry_hours` 24. **Coverage** is a circle:
  `coverage_centre_lat` / `coverage_centre_lng` (Invercargill, -46.4132 / 168.3538) and `coverage_radius_km` (60 km, 1–200);
  a point is covered when it's within the radius of the centre (#97 reads these). Pricing copies the rates into
  `job_pricing`, so editing settings never changes a priced job.
- **Money rules live in the database too.** Refunds never exceed the amount and agree with the status; a paid
  payment's amount can't change and it can't go back to unpaid; one live (not FAILED) payment per job, quick look
  or piece of extra work; a variation payment is on its own job. Extra work follows its status order, with the
  ask frozen once priced and the price frozen once decided. A payout can't go backwards or change once exported.
  Jobs with payments or payouts can't be deleted. Settings can't be deleted or given a second row.
- **Auth link without a foreign key.** Prisma only manages `public`, and a foreign key into `auth.users` stops it
  reading the database, so triggers do that job: a profile needs an auth user, and deleting the auth user deletes the
  profile (and everything hanging off it).
- **Row-level security is on for every table.** The app's server code connects as the table owner and isn't limited
  by it; it protects the Supabase Data API that the browser can reach with the public key. There, people can read
  their own rows and write nothing. Customers also read their own jobs' photos, windows and history; workers read
  their own estimates. Customers never see estimates or `job_pricing`, and workers get no policy on `jobs` yet
  (it holds the customer's price). Customers read their own jobs' payments; workers read their own payouts; nobody
  else reads either. `variations` and `job_materials` mix worker pay or costs with the customer's price, so they have
  no policy yet. `payroll_details`, `job_pricing` and `settings` have no policy at all. Wider rules come with
  who-sees-what (#95).
- **Encrypted fields.** IRD numbers and bank accounts are encrypted by `encryptField()` (`src/server/crypto.ts`,
  AES-256-GCM, key in `FIELD_ENCRYPTION_KEY`) before they're saved, and bound to their row so a copied value won't
  decrypt elsewhere. The last digits are stored separately for the masked display.
- **Plain Postgres works too.** The first migration creates stand-ins for Supabase's `auth.users` and `auth.uid()`
  when they don't exist (local Docker, CI, Prisma's shadow database). On Supabase it does nothing.

## Tokens, fonts and modes (#72)

- **Tokens.** `src/styles/tokens.css` is the app's copy of `docs/design/tokens.css`, imported once in
  `src/app/layout.tsx`. It is the only file allowed to hold hex colours; everything else uses `var(--trade-…)`.
  `tests/unit/no-hex.test.ts` fails `npm test` (and CI) on a hex value anywhere else in `src/` (CSS, CSS modules,
  TS/TSX strings, inline styles, SVG fills; comments are ignored). `tests/unit/tokens.test.ts` fails if the app copy's
  token values drift from `docs/design/tokens.css`. Changing either needs Matt's review.
- **Fonts.** Self-hosted in `public/fonts/` (licences and notes in `public/fonts/README.md`). `Trade Display` and
  `Trade UI` are one Roboto Flex variable file with `font-display: swap`; Material Symbols Rounded keeps `block` from
  the tokens file. The root layout preloads both (`src/lib/fonts.ts`).
- **Icons.** Use `<Icon>` (`src/components/Icon.tsx`), never the font directly. It must be given a `label` (stands
  alone: `role="img"` + `aria-label`) or `decorative` (text next to it says the same), so nothing loses its meaning
  if the icon font fails.
- **Modes.** `data-mode` on `<html>` picks the palette: `customer` (also when signed out), `trade`, `office`.
  `modeForRole()` (`src/lib/mode.ts`) maps CUSTOMER → customer, TRADIE → trade, ADMIN → office, none → customer.
  The root layout renders the attribute on the server, so the first paint already has the right colours (no flash,
  no client script).
  - **Signed in (#101):** `RootLayout` is async and reads the visitor's role on the server with `getViewer()`, then
    passes it to `modeForRole(role)`. Log-in and log-out revalidate the layout (`revalidatePath("/", "layout")`)
    and redirect, so the attribute changes with the next page; after `logInAgainAction`, call `router.refresh()`.
  - Components only use the mode tokens (`--trade-action`, `--trade-on-action`, `--trade-signature`, …), never the raw
    brand colours, so they recolour themselves. A preview of another mode can set `data-mode` on any element, but
    because customer colours live on `:root`, a `data-mode="customer"` area inside a trade/office area doesn't reset.
- **`/dev/tokens`** shows every token (read from `src/styles/tokens.css` at request time), per mode
  (`?mode=trade`, `?mode=office`), the type scale in both families and an icon sample (`?icons=off` simulates the icon
  font failing). It only works under `npm run dev`; in a production build it returns `notFound()` (404).
