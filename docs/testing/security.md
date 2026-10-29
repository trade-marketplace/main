# Account security verification (#113)

The unit tests use fakes. The UI preview at `/dev/components/security` is guarded like the other `/dev` pages and
never calls an Auth provider or a database. Run `tests/e2e/security.spec.ts` against a dev server with
`E2E_DEV_BASE_URL=http://127.0.0.1:3000` for all states, widths, keyboard, focus and axe checks.

States: `wrong`, `success`, `unavailable`, `limited`, `expired`, `partial`, `pending-email`, `invalid-link`, `loading`,
`offline`, `pending` (static pending state for screenshots).
`access-errors` shows the reauthentication, rate-limit and expired-session messages together for screenshot review.
`saving` delays an interaction for two seconds so pending controls and progress announcements can be checked.
`mode=trade` checks the tradie palette. These query flags only affect the guarded preview, never real account data.

For the complete signed-in journey, use a **disposable plain Postgres** on localhost, named `…local_security…`,
and apply the existing Prisma migrations to it. Never use a Supabase database. Start the app with:

```sh
DATABASE_URL=postgresql://postgres@127.0.0.1:54329/tm_local_security \
DIRECT_URL=postgresql://postgres@127.0.0.1:54329/tm_local_security \
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54322 \
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_local_security \
npm run dev -- --hostname 127.0.0.1 --port 3101
```

Run `tests/e2e/security-signed-in.spec.ts` with `SECURITY_E2E_APP_URL=http://127.0.0.1:3101` and
`SECURITY_E2E_DATABASE_URL` set to that disposable database URL. It starts an in-memory Auth HTTP double on port
54322, inserts synthetic profiles, and exercises the real login form, guarded pages, server actions, Supabase SDK,
PKCE exchange and profile writes. There are no test hooks in production application code. The provider double is
not a verification of live Supabase project settings or email delivery. It models revocation of refresh sessions;
as with Supabase, already issued access tokens can remain valid until their expiry.

The normal CI build and Playwright configuration leave database/Auth off. Signed-in integration tests skip unless
both isolated-test variables above are present; the normal signed-out route-protection case still runs.

Review references: desktop `docs/design/pages.html#w-account`, phone `docs/design/screens.html#sh-profile-edit`,
WEBAPP_SPEC E05 and Account settings notes, FRONTEND_SPEC sections 4–6. Security has no dedicated mockup.

William reviews the Auth integration. Email changes use the existing Supabase Email Change template/confirmation
flow; allow `/profile/security/confirm` on the app's deployment origins in Auth's redirect URL allowlist and keep
Secure email change enabled. No live provider settings are changed by this PR. Merely opening Security never
promotes `profiles.email_verified_at` from Auth's automatic confirmation timestamp (#106); the callback marks
ownership proved only after a successful code exchange for the same user. If Auth changes an address without
proof, the profile becomes unverified and the existing `/verify` banner supplies the confirmation journey.

`/profile` currently redirects to Security so the existing desktop Account menu and phone Account icon have a
working destination. The profile editor in #112 replaces that entry route; its other account pages retain their
planned URLs. This task does not implement those pages.
