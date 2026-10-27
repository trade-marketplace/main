# Log in

Issue #102, sitemap B01. Page: `src/app/login/page.tsx`. Pieces: `src/components/auth` (`AuthLayout`, which
sign-up reuses; `LoginForm`; `login-messages.ts`). Every answer, without Supabase: `/dev/components/login?state=`
wrong | locked | unverified | invalid | unavailable (dev only).

## How it works

- **Layout:** from 1024px it matches w-login: a Forest brand panel (logo, illustration, bolt, "Sorted in a
  flash.") and the form centred in the right half, max 440px. Under 1024px it matches pub-login: a Forest band
  with a back arrow, then the form. There's no site header.
- **Form:** it posts to `logInAction` (#101). After a failed try the email stays, the password is emptied, and
  focus goes to the field to fix. Enter submits, and the button shows its spinner while it works.
- **Messages** (`login-messages.ts`):
  - **Wrong email or password:** one message under the password: "That email and password don't match. Try
    again or reset it." It never says whether the account exists.
  - **Too many tries:** a banner, "Too many tries. Wait a few minutes, or reset your password."
  - **Email not confirmed:** a banner, "Confirm your email first."
  - **Something failed:** a banner, "We can't log you in right now."
- **Deep links:** `?next=` goes back with the form. `afterLoginPath` (#101) keeps it only if it's one of our pages
  the person may open; otherwise they go to their home. "Create an account" keeps it too.
- **Keep me logged in** is ticked by default:
  - **Ticked:** the session cookies last 30 days from the last visit.
  - **Not ticked:** they're browser-session cookies.
  - **How the choice is kept:** a `tm-session-only` marker cookie, so the proxy's refreshes keep honouring it.
    `src/server/supabase.ts` (`sessionCookieOptions`) handles this.
  - **Log out** clears the marker.
- **Unconfirmed email in the app:** a signed-in customer or tradie who hasn't confirmed their email sees a
  "Confirm your email." banner in the app shell, linking to `/verify`.

## Tests

- `tests/unit/login.test.tsx` covers:
  - the cookie options (30 days, browser session, deletions untouched, the marker on refresh);
  - the messages;
  - the form's HTML in each state (email kept, password empty);
  - the page (one h1, the deep link only for our own paths).
- `tests/unit/login-action.test.ts` covers what the action does with Keep me logged in, and on log-out.
- `tests/e2e/login.spec.ts` covers:
  - the real page on the production build: axe and sideways scroll at every width, a keyboard try with
    show/hide password, Keep me logged in, the links;
  - every answer on the dev preview: axe at every width, 200% text.

## Notes for review

- **William (auth):**
  - **Keep me logged in:** it changes the session cookie lifetime from @supabase/ssr's 400 days to 30 days (or
    the browser session). Code: `sessionCookieOptions`, `createSupabaseClientWithCookies`,
    `rememberSessionChoice`.
  - **No lockout after wrong passwords** (Matt's decision, in DECISIONS.md). The "Too many tries" banner shows
    only when Supabase's own rate limit answers. The wording doesn't promise 10 or 15 minutes, because the wait
    depends on that limit.
  - **Log in before the email is confirmed: yes** (Matt's decision, in DECISIONS.md). That needs Supabase's
    "Confirm email" setting off; until it is, Supabase refuses the log-in and the page says "Confirm your email
    first." Posting and claiming must check `emailVerified` themselves (their own issues). The app shell's
    "Confirm your email." banner is ready.
- **Matt:**
  - **Field labels (Matt):** as in the mockup, no label above the fields, just "Email" and "Password" as
    placeholders. The labels are still there for screen readers, out of sight.
  - **Phone wording (Matt):** the second button says "Sign up" on a phone and "Create an account" on a computer,
    as in each mockup.
  - **New illustration:** `public/images/auth/phone.png` is a copy of `docs/design/img/phone.png`.
