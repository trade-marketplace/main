# Services and accounts

What the web app runs on, and where to find it. **No secrets in this file, ever.** Keys and passwords live in
Vercel's environment variables and the founders' password managers.

## Supabase (database, sign-in, file storage, timers)

| | |
|---|---|
| Project ref | `tlqyzgvlkdtiwizisfmp` |
| Project URL | `https://tlqyzgvlkdtiwizisfmp.supabase.co` |
| Region | Sydney (`ap-southeast-2`) |
| Plan | Free until launch, then Pro (see DECISIONS.md #58) |
| Owners | Matt, William |

Used for (DECISIONS.md #58–#61):
- **Postgres**: all app data.
- **Auth**: sign-in (email + password at launch). Auth emails sent through Resend.
- **Storage**: private buckets, signed URLs that expire. Photos resized (~1600px WebP) before upload.
- **pg_cron**: every-minute timers (bounty expiry, 48h auto sign-off, reminders, unclaimed alerts).

### Rules for agents
- Link the repo to the project with the Supabase CLI inside the repo (`supabase init` once, then
  `supabase link --project-ref tlqyzgvlkdtiwizisfmp`). Commit the `supabase/` folder (migrations, config), never
  `.env` files.
- **Database changes are migrations** in `supabase/migrations/`, reviewed by William. Never edit the production
  schema by hand in the dashboard.
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
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` (or publishable key) | browser + server | no (public by design, protected by row-level security) |
| `SUPABASE_SERVICE_ROLE_KEY` (or secret key) | server only | **yes** |
| `DATABASE_URL` (pooled) / `DIRECT_URL` | server, migrations | **yes** |

## Vercel (hosting, preview links)
Not connected yet. The repo is private and owned by an organization, so Vercel needs the Pro plan (about US$20/month)
or the repo must be public. Functions region: **Sydney (`syd1`)**, next to the database.

## Other
- **Email:** Resend, from `hello@trademarketplace.nz` (domain not bought yet).
- **Push notifications:** Firebase. **No SMS at launch.**
- **Analytics:** Plausible or Fathom.
- **Domain:** trademarketplace.nz (+ .co.nz redirect), not bought yet.
