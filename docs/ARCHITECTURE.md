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
| `tests/` | Tests. `tests/unit/` runs with `npm test` (Vitest). |
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

## Sign-in

Sign-in will use **Supabase Auth** (DECISIONS.md, #60). The prototype's jose/bcrypt sessions are not ported.
