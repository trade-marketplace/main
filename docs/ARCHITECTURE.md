# Architecture

A single Next.js app (App Router, TypeScript strict) on **Vercel**, with **Supabase Postgres** through Prisma. Both
run in **Sydney** (`vercel.json` pins functions to `syd1`). See DECISIONS.md (#58).

## Folder layout

| Folder | What goes there |
|---|---|
| `src/app/` | Routes: pages, layouts, route handlers, server actions. Keep them thin; call into `src/server`. |
| `src/components/` | UI components. Built from the design kit (`docs/design/`), tokens only, no hard-coded hex. |
| `src/server/` | Server-only logic: database access, job status rules, pricing, who-sees-what. Files that touch secrets or the database start with `import "server-only"`, so they can never end up in browser code. |
| `src/lib/` | Small helpers safe on both server and browser (formatting, shared types). No secrets, no database. |
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

Sign-in will use **Supabase Auth** (DECISIONS.md, #60); files go in **Supabase Storage** (#59). The prototype's
jose/bcrypt sessions are not ported.

- `createSupabaseServerClient()` (`src/server/supabase.ts`) is for Server Components, Server Actions and Route
  Handlers. It acts as the signed-in visitor through their cookies.
- `createSupabaseBrowserClient()` (`src/lib/supabase/browser.ts`) is for Client Components.
- Both are optional like the database: until `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
  are set they throw an error that says how to connect. The session-refresh proxy arrives with sign-in (#101).

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
  - **When sign-in lands (#101):** make `RootLayout` async, read the signed-in user's role on the server (via
    `createSupabaseServerClient()` and the user's row), and pass it to `modeForRole(role)` instead of `null`. After
    log-in/log-out, redirect or `router.refresh()` so the layout re-renders and the attribute changes with the page.
  - Components only use the mode tokens (`--trade-action`, `--trade-on-action`, `--trade-signature`, …), never the raw
    brand colours, so they recolour themselves. A preview of another mode can set `data-mode` on any element, but
    because customer colours live on `:root`, a `data-mode="customer"` area inside a trade/office area doesn't reset.
- **`/dev/tokens`** shows every token (read from `src/styles/tokens.css` at request time), per mode
  (`?mode=trade`, `?mode=office`), the type scale in both families and an icon sample (`?icons=off` simulates the icon
  font failing). It only works under `npm run dev`; in a production build it returns `notFound()` (404).
