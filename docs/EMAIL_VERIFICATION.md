# Email ownership confirmation

`/verify` confirms email ownership independently of Supabase's automatic account confirmation. People can still
log in with their password before confirming. Only a successful server-side `verifyOtp` marks the matching
profile email verified. Signup and password login never copy `email_confirmed_at` into that field.

The email provider's one-time email token is used only as proof of ownership. A separate, non-persistent Auth
client sends and verifies it. Its temporary session is revoked with `scope: local`; the browser's existing
session and other devices stay signed in. This does not add passwordless login.

## William's deployment configuration

Auth changes require William's review. Keep the decided Confirm Email setting off so password login remains
available. Configure Supabase Auth's **Magic Link** and **Confirm signup** email templates to use the server's
redirect and token hash:

```html
<h2>Confirm your email</h2>
<p>Tap the link to confirm your email for Trade Marketplace.</p>
<p><a href="{{ .RedirectTo }}&amp;token_hash={{ .TokenHash }}&amp;type=email">Confirm email</a></p>
```

Allow `https://trademarketplace.nz/verify/confirm` in Auth's redirect URL configuration. The application always
supplies this canonical origin and an encoded, internal `next` path. Auth email goes through the configured Resend
SMTP service, as decided in #60/#63. No service key is needed. The provider controls token expiry and the server
handles expired, reused and invalid tokens with a resend action. The page displays a 60-second cooldown and the
provider enforces its own rate limits, including requests from another tab.

Holding pages poll every five seconds and on returning to the tab. Signed-in people continue to their role's
allowed destination; signed-out people return to password login with their original destination preserved.
The completion cookie lasts one day so a suspended holding tab can catch up. A new email request clears it.
It only controls the success message; it never grants a session or job permission.

#353 retains the server-side posting/claiming guards and any cleanup of historical provider-auto-confirmed rows.
These changes do not migrate or update existing accounts automatically.

## Verification without Supabase

Unit tests inject fake Auth and profile stores. Browser tests use the guarded `/dev/components/verify-email`
preview for waiting, cooldown, expired, invalid, already verified, loading, send failure and cross-tab states.
Public `/verify?state=verified` cannot fake verification. Database and Auth environment variables stay empty
through lint, typecheck, tests, build and browser checks.
