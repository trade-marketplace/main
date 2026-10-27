# Session expired dialog

Issue #108 (B07). Code: `src/components/auth/SessionExpired.tsx`. Mockup: `w-modals` ("Dialogs", the third card) in
`docs/design/pages.html`. Every state, live: `/dev/components/session-expired` (dev only).

When a protected server action finds the session gone, it answers `session-expired` instead of redirecting
(`withRole` in `src/server/auth/guard.ts`, #101). The page shows this dialog over itself:

1. **"You've been logged out"** with the lock_clock tile, "For your security. Log in again and you'll be right back
   here. Your draft is saved." and one button, **Log in again**.
2. **Log in again** turns it into a log-in form in the same dialog. The person's email is already known, so it asks
   only for the password ("Logging in as sarah@email.co.nz"). If the email isn't known, it asks for that too.
3. Once they're logged in, the dialog closes and the form that failed is sent again. When that has finished, the
   page refreshes its server data (`router.refresh()`), so it shows what was saved. The page and anything typed stay as they were, and focus goes back to the button
   that sent the form.

Esc, a click on the scrim and swiping do nothing; there is no ×. Focus is trapped inside (the kit's `<Dialog>`, #78).

## Using it

Every signed-in shell already has the provider: `AppShell` (customers and tradies) and `OfficeShell` (the office).
A page only has to check what its action answered:

```tsx
const sessionExpired = useSessionExpired();

async function save(formData: FormData) {
  const result = await saveDraftAction(formData);
  if (sessionExpired.check(result, { resend: () => save(formData) })) return;
  // …the usual success and error handling
}
```

- `check(result, options)` shows the dialog and returns true if `result` is `session-expired`. Otherwise it returns
  false and does nothing.
- `show(options)` opens it for anything else that finds the session gone (e.g. a `fetch` that got a 401).
- `options.resend` runs after logging in again. `options.draft: false` leaves out "Your draft is saved." for
  pages with nothing typed.
- Only one at a time: a second call while it shows is ignored.
- React clears a `<form action>` after it's sent. To keep what was typed, use controlled fields, or put
  `result.values` back as each field's `defaultValue` (`keptFormValues`, `src/lib/auth/results.ts`).

## What if…

| Case | What happens |
|---|---|
| Wrong password | "That email and password don't match. Try again." under the password, which is cleared and focused. Same words as the log-in page (#102). |
| Too many tries, email not confirmed, sign-in down | A banner over the form, read out at once. |
| Someone else is at the computer | **Not you? Log in as someone else** goes to `/login`. The draft isn't sent for them. |
| A different kind of account logs in (a tradie over a customer page) | They go to their own home, and the draft is not sent (`afterLogInAgain`). |
| Sign-in isn't set up (no Supabase) | "We can't log you in right now." |

## Tests

- `tests/unit/session-expired.test.tsx`: the message for each answer, `afterLogInAgain`, the HTML of each step,
  the provider, both shells mounting it, and the mockup's tile and width.
- `tests/e2e/dev-session-expired.spec.ts`: axe and no sideways scroll at 320 / 390 / 768 / 1024 / 1440; the mockup
  at 1440; Esc, the scrim and the focus trap; the whole round trip (wrong password, then right, draft sent, focus
  back); the banners; the unknown-email form. Run it against `npm run dev`:
  `E2E_DEV_BASE_URL=http://localhost:3000 npx playwright test tests/e2e/dev-session-expired.spec.ts`.

## Notes for review

- **Matt:**
  - The mockup's card has a ×, but its notes say Esc doesn't close this dialog. I left the × out: closing it would
    leave someone on a page that can't save anything.
  - The second step (password in the dialog) isn't in the mockup. It uses the kit's fields and the log-in page's
    wording.
  - The title is 24px (the nearest type token to the mockup's 22px), so it fits on one line on a computer.
- **William:**
  - The dialog calls `logInAgainAction` (already in `src/server/auth/actions.ts` from #101). It answers
    `{ ok: true }` instead of redirecting. Nothing on the server changed.
  - The 5-tries lock is still #111. Until then "Too many tries" comes only from Supabase's own rate limit.
