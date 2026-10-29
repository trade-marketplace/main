# Services and accounts

What the web app runs on, who controls each account, and where to find it. **No secrets in this file, ever.** Keys
and passwords live in Vercel's environment variables, Supabase Auth's encrypted SMTP settings and the founders' password managers.

## Who controls what

| Service | What it does | Account / owner | Plan | Status |
|---|---|---|---|---|
| **GitHub** org `trade-marketplace`, repo `main` | Code, issues, CI, PR gate | Org owners: Matt (`mlarsen084`), William (`willimobro`) | Free (repo **public** for now so Vercel Hobby can deploy) | ✅ Live |
| **Vercel** project `trade-marketplace/main` | Hosting, live site, preview link per PR | Matt's Vercel account (signed in with GitHub `mlarsen084`) | Hobby (free) → Pro before launch (~US$20/mo) | ✅ Live at https://trademarketplace.nz/ |
| **Supabase** project "Trade Marketplace Sydney" (`bwbwbpnqfxjdkbompsvg`) | Database, sign-in, file storage, timers | Supabase org owned by Matt; William to be invited as Owner | Free → Pro at launch (~US$25/mo) | ✅ Connected; tables created on each production deploy |
| Supabase project "Trade Marketplace Main" (`tlqyzgvlkdtiwizisfmp`, Singapore) | Nothing (first attempt, paused) | Same org | Free | ⚠️ Unused; safe to delete |
| **Mapbox** | Address search, maps | Matt's Mapbox account (`mlarsen084`) | Free tier | ✅ Token set in Vercel |
| **Claude GitHub App** | Lets Claude agents push and open PRs | Installed on the org by Matt | — | ✅ |
| **Domain** trademarketplace.nz (+ intended .co.nz redirect) | Real web address, email sender | Registrar/account details to confirm | ~NZ$30–40/yr each | ✅ Primary verified/live; .co.nz not yet verified |
| **Resend** (email) | Decided sender: `hello@trademarketplace.nz` for sign-in and job emails | Matt / William to configure Auth SMTP; Resend account status not inspected | Free tier | ⚠️ Auth dashboard requests custom SMTP setup; default templates active |
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


### Auth email configuration (30 October 2026)

Matt owns the Sydney project and handled the SMTP credential step. Resend verifies `trademarketplace.nz` through
Cloudflare DNS. Supabase Auth sends from **Trade Marketplace <hello@trademarketplace.nz>** using `smtp.resend.com`,
port **465** (TLS), username `resend`; the restricted sending credential is stored only in Supabase's encrypted
SMTP settings. No secret belongs in this repository or a PR description.

Verification email images are served over HTTPS from **assets.trademarketplace.nz**, using the public-only
Cloudflare Worker `trade-marketplace-email-assets`. The supplied SVG, transparent PNG, handler source and
deployment notes are in [`supabase/templates`](../supabase/templates/README.md). The Worker embeds the logo
and has no credentials, upstream fetches or storage bindings. Hosted Auth templates are updated separately
from Vercel application deployments.

- Site URL: `https://trademarketplace.nz`.
- Allowed callbacks: `/verify/confirm`, `/recovery/confirm` and `/profile/security/confirm` on that exact origin.
- Confirm Email stays **off**, Secure email change stays **on**, minimum password length is **10**.
- Confirm signup and Magic link/OTP use the token-hash template in `docs/EMAIL_VERIFICATION.md`.
- Reset password uses the token-hash template in PR #384's `docs/PASSWORD_RECOVERY.md`; the route becomes live
  when that PR is merged and deployed. Code checks use disposable localhost Postgres and Auth doubles; a founder
  checks real delivery separately.

This configures Supabase Auth email only; it does not implement the app notification provider in #110.

## Vercel (hosting, preview links)
Connected. Production deploys from `main` at https://trademarketplace.nz/ (Hobby plan while the repo is public;
Pro before launch). Every PR gets a preview link. Environment variables (Production + Preview) are set in Vercel.
Production deploys run `scripts/migrate-on-deploy.mjs` first (`vercel-build`), which applies pending Prisma migrations
to Supabase. Preview deploys never change the database schema.

### Verified live configuration (29 October 2026)

Read-only Vercel connector inspection confirms the existing project, not a new deployment:

- Team `trade-marketplace`, project `main` (`prj_2IXyfVBFTACe4M08iDkk24e5KUZB`).
- `trademarketplace.nz` is verified and serves production. `www.trademarketplace.nz` is verified and redirects to
  the primary domain with HTTP 308. `https://main-ashy-tau.vercel.app/` remains a working Vercel alias.
- Production deployment `dpl_3JhMJp5MuLiKtEL4damvQXLNUTZv` was Ready in Sydney (`syd1`), serving main commit
  `49ac856` (#381). The homepage and `/verify` both returned HTTP 200.
- `.co.nz` is still the decided redirect, but it is not in this project's returned domain list. Its registration
  and redirect status remain unverified; do not infer that it is live.
- The connector lists the five environment variable names documented above. No values were decrypted or copied.
  No Resend variable was listed; that fact alone does **not** establish Supabase Auth's SMTP configuration.

### Checking the email people actually receive

Vercel hosts the app; Supabase Auth stores the live confirmation/recovery email templates and SMTP configuration.
Domain verification does not prove those templates, the sender address or email delivery are configured.

After Matt signed in, read-only Authentication → Email Templates inspection confirmed:

- The dashboard says **Set up custom SMTP to edit templates** and **Emails will be sent using the default templates**.
- **Confirm sign up:** subject **Confirm your email address**; the preview asks the recipient to confirm the email
  and finish signing up. Its link uses `{{ .ConfirmationURL }}`.
- **Magic link or OTP:** subject **Your sign-in link**; its preview describes a one-time sign-in link. This is the
  template used by #381's resend machinery, but it is not yet the app-specific confirmation template.

The templates in `docs/EMAIL_VERIFICATION.md` remain proposed configuration, not the current live messages.
William must configure the decided SMTP provider and token-hash callback templates before the #381/#384 app
flows can complete through the live emails. This operational blocker is tracked in
[#388](https://github.com/trade-marketplace/main/issues/388), separately from #110's notification-provider wiring.

To review a received message rather than the dashboard preview, use a screenshot or saved message with its
one-time confirmation link removed. Never publish live tokens, request real email as part of automated tests,
or connect those tests to Supabase.

The Supabase connector also confirmed project metadata: Trade Marketplace Sydney, `ACTIVE_HEALTHY`, region
`ap-southeast-2`. It exposed no Auth-template/SMTP management tool in this session; the template facts above came
from the signed-in dashboard. No service settings were changed, no email was sent and no database command was run.
