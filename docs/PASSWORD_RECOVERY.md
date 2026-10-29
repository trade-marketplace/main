# Password recovery (#107)

**William must review this auth/session flow and configure its email template before use.** No schema or migration
changes. Nothing here runs against Supabase during tests.

## Flow

- `/login` → Forgot password → `/recovery`, retaining a safe original `next` destination.
- The server calls `resetPasswordForEmail` using a stateless client. Existing and missing accounts receive the
  same response. A 60-second resend cooldown is enforced both in the browser and the pending cookie; Supabase's
  rate limits remain authoritative. No account lockout is added.
- `/recovery/confirm?token_hash=…&type=recovery&next=…` exchanges a one-time token server-side. Supabase uses the
  same `otp_expired` error for expired and reused tokens, so both receive “That link has expired or was already
  used.” Neither can establish another reset session. Other malformed links receive the invalid-link state.
- The callback strips the token from the redirect, sends `no-store` and `no-referrer`, and puts the temporary
  proof session in a separate `tm-recovery-auth` HttpOnly/Secure/SameSite=Lax cookie, scoped to `/recovery` for an
  hour. It never replaces or creates an ordinary app login. Opening a link on another browser works without the
  requesting browser's cookies. A query flag alone cannot open the password form or authorize an update.
- Saving validates the current proof session with Auth `getUser`, then applies the shared 10-character/72-byte,
  common-password and email checks plus confirmation. No password is logged, returned, or stored in cookies.
- After saving, Auth's global logout endpoint revokes every session. Completion is not shown until this succeeds. If revocation
  fails, the screen says the password is saved and offers **Finish reset**, including after reload; retry does not
  write the password twice. `tm-recovery-saved` is only a workflow hint; it authorizes no account changes.
  This calls the SDK's underlying `auth.admin.signOut(jwt, "global")` with the recovery session's own access token
  and the publishable client, not a service-role key. Unlike `auth.signOut`, it preserves the proof cookie after a
  server failure, allowing a real retry. The Auth server authorizes revocation. Missing/revoked proof is never
  treated as successful global logout; a fresh reset link is required if that proof has gone.
- Recovery cookies are cleared on completion, the normal browser cookie is locally cleared, and the user logs in
  again with the new password. The complete marker is informational, never an authenticated session.
- Recovery does not change the app's independent `profiles.email_verified_at` ownership flag (#106/#353).

## Immediate old-device rejection

`getClaims` alone validates an unexpired JWT, which can outlive logout. The proxy and viewer now use `getUser`,
which asks Auth to validate the active session. A globally revoked session is rejected on its next protected
request even if its JWT has time left. Role data still comes only from `profiles`, and the viewer remains cached
for one request. Auth outages fail closed. This adds an Auth round trip to signed-in requests.

This covers application requests through our server. Already-rendered pages cannot be erased from another
device; that device's next request must log in again. Direct Storage/Realtime authorization is separate and must
not be assumed to provide the same immediate-revocation guarantee.

Sources: [Auth session validation](https://github.com/supabase/auth/blob/master/internal/api/auth.go),
[Supabase sessions](https://supabase.com/docs/guides/auth/sessions),
[resetPasswordForEmail](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail).

## Email and redirect configuration (William)

Use the existing Sydney project from `docs/SERVICES.md`; do not create a new project. In Authentication → Email
Templates → Reset password, the link must go to our token-hash callback, not return browser tokens in a fragment:

```html
<h2>Reset your password</h2>
<p>Follow this link to choose a new password for Trade Marketplace.</p>
<p><a href="{{ .RedirectTo }}&amp;token_hash={{ .TokenHash }}&amp;type=recovery">Reset password</a></p>
<p>If you didn’t request this, you can ignore this email.</p>
```

`RedirectTo` always includes `?next=…`. The app uses Vercel's trusted `VERCEL_PROJECT_PRODUCTION_URL` when present,
so the callback follows the project's configured production hostname. The Vercel connector confirms the live
primary domain is `trademarketplace.nz`; outside Vercel this is also the fallback. Add the exact production callback URL/path to the Auth redirect allowlist. Never
derive this security-sensitive origin from a submitted form, request Host header or `next` value.

Keep password login, the existing SMTP decision (Resend), and Confirm Email off as DECISIONS.md requires. This PR
does not change project settings, send real email, deploy, or run database commands.

## Verification and screen review

Production route: `/recovery`. Guarded fixtures: `/dev/components/recovery?state=…`, with request, sent, cooldown,
reset, mismatch, complete, expired, invalid, unavailable, finish, loading, reset-loading, offline, reset-offline,
send-error and save-error. `/dev` remains unavailable on Vercel, including preview deployments.

Run the recovery unit tests and browser tests with database and Supabase credentials empty. The real SDK is
also tested against a fake fetch boundary for cookie isolation, one-time proof and immediate session revocation.
