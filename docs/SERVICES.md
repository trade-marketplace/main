# Services and accounts

What the web app runs on, who controls each account, and where to find it. **No secrets in this file, ever.** Keys
and passwords live in Vercel's environment variables and the founders' password managers.

## Who controls what

| Service | What it does | Account / owner | Plan | Status |
|---|---|---|---|---|
| **GitHub** org `trade-marketplace`, repo `main` | Code, issues, CI, PR gate | Org owners: Matt (`mlarsen084`), William (`willimobro`) | Free (repo **public** for now so Vercel Hobby can deploy) | ✅ Live |
| **Vercel** project `trade-marketplace/main` | Hosting, live site, preview link per PR | Matt's Vercel account (signed in with GitHub `mlarsen084`) | Hobby (free) → Pro before launch (~US$20/mo) | ✅ Live at https://main-ashy-tau.vercel.app/ |
| **Supabase** project "Trade Marketplace Sydney" (`bwbwbpnqfxjdkbompsvg`) | Database, sign-in, file storage, timers | Supabase org owned by Matt; William to be invited as Owner | Free → Pro at launch (~US$25/mo) | ✅ Connected; tables created on each production deploy |
| Supabase project "Trade Marketplace Main" (`tlqyzgvlkdtiwizisfmp`, Singapore) | Nothing (first attempt, paused) | Same org | Free | ⚠️ Unused; safe to delete |
| **Mapbox** | Address search, maps | Matt's Mapbox account (`mlarsen084`) | Free tier | ✅ Token set in Vercel |
| **Claude GitHub App** | Lets Claude agents push and open PRs | Installed on the org by Matt | — | ✅ |
| **Domain** trademarketplace.nz (+ .co.nz redirect) | Real web address, email sender | Not bought yet | ~NZ$30–40/yr each | ⏳ |
| **Resend** (email) | Sign-in and job emails from `hello@trademarketplace.nz` | Not set up yet (needs the domain) | Free tier | ⏳ |
| **Firebase** (push) | Job alerts and pings | Not set up yet | Free tier | ⏳ |
| **Stripe** (test mode) | Payments, Apple Pay | Not set up yet (#151, William) | — | ⏳ |
| **Plausible or Fathom** | Privacy-friendly analytics | Not chosen yet | Paid (small) | ⏳ |

When an account changes hands or a new service is added, update this table in the same PR.

### Keys in Vercel (Production + Preview)
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `DATABASE_URL`, `DIRECT_URL`, `MAPBOX_ACCESS_TOKEN`.
Not set (on purpose): `FIELD_ENCRYPTION_KEY` (needed before bank/tax details go live), `SUPABASE_SECRET_KEY`,
`ALLOW_SEED`, `SEED_DEMO_PASSWORD` (seed/test only, never production).

## Supabase (database, sign-in, file storage, timers)

| | |
|---|---|
| Project | Trade Marketplace Sydney |
| Project ref | `bwbwbpnqfxjdkbompsvg` |
| Project URL | `https://bwbwbpnqfxjdkbompsvg.supabase.co` |
| Region | Sydney (`ap-southeast-2`) |
| Plan | Free until launch, then Pro (see DECISIONS.md #58) |
| Owners | Matt, William |

Used for (DECISIONS.md #58–#61):
- **Postgres**: all app data.
- **Auth**: sign-in (email + password at launch). Auth emails sent through Resend.
- **Storage**: private buckets, signed URLs that expire. Photos resized (~1600px WebP) before upload.
- **pg_cron**: every-minute timers (bounty expiry, 48h auto sign-off, reminders, unclaimed alerts).

### Rules for agents
- **Database changes are Prisma migrations** in `prisma/migrations/` (set up in #67), reviewed by William.
  Row-level security policies, pg_cron jobs and storage policies are plain SQL inside those migrations.
  Never edit the production schema by hand in the dashboard. Never commit `.env` files.
- **Previews and tests must not use this project's real data.** A second free project,
  `trade-marketplace-staging`, will hold demo data for preview links (to be created when previews are set up, #89).
- Supabase row-level security works on **rows, not fields**. Fields a role must never see (customer price for
  tradies, address and phone before claiming, estimates for customers) go in separate tables or are only read on
  the server. See the who-sees-what task (#95).
- Server-only keys (`service_role` / secret keys) are used **only** in server code and never sent to the browser.

### Environment variables (names only; values are in Vercel)
| Name | Where it's used | Secret? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | browser + server | no |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | browser + server | no (public by design, protected by row-level security) |
| `SUPABASE_SECRET_KEY` | server only (seed scripts) | **yes** |
| `MAPBOX_ACCESS_TOKEN` | server only | yes |
| `DATABASE_URL` (pooled) / `DIRECT_URL` | server, migrations | **yes** |

## Vercel (hosting, preview links)
Connected. Production deploys from `main` at https://main-ashy-tau.vercel.app/ (Hobby plan while the repo is public;
Pro before launch). Every PR gets a preview link. Environment variables (Production + Preview) are set in Vercel.
Production deploys run `scripts/migrate-on-deploy.mjs` first (`vercel-build`), which applies pending Prisma migrations
to Supabase. Preview deploys never change the database schema.
