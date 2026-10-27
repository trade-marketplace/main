# App navigation (signed-in shell)

Issue #84. Code: `src/components/app` (import from `@/components/app`). The links, which one is current and the
avatar menu's items are in `src/components/app/app-links.ts`. What the server adds is in `src/server/app-shell.ts`:
the last name, the unread count and test mode. Every state, live: `/dev/components/app-shell` (dev only).

| Where | What | Spec |
|---|---|---|
| Computer, from 1024px | Forest top nav, 68px, sticky. It has the logo, the "Tradie" flag (trade mode), the section links with icons, "Post a job" (customers), the bell with its count, and the avatar menu | web.css `.w-appnav`; pages.html w-c-home, w-t-board, w-notifs |
| Phone and tablet, under 1024px | A white bottom bar with five icons. It is 64px tall plus the phone's safe area | components.css `.tm-nav`; screens.html cus-home, tr-home, tr-earnings |
| Everywhere | A skip link, then the gold test-mode strip while payments are in test mode | WEBAPP_SPEC; AGENTS.md (payments stay in test mode) |

## Using it

Put every customer and tradie page in `src/app/(app)/`. Its layout wraps them in `<AppShell>`, which reads who is
signed in on the server. The route group doesn't change URLs: `(app)/dashboard/page.tsx` is still `/dashboard`.
The office has its own shell (#85). The public site keeps `<SiteShell>` in `(site)`.

```tsx
// Already done by src/app/(app)/layout.tsx:
<AppShell>{children}</AppShell>
// A preview or a test with a viewer you already have:
<AppShellView viewer={{ role: "CUSTOMER", firstName: "Sarah", lastName: "Thompson", email, counts }} testMode>…</AppShellView>
// A phone page with its own Forest band (customer home, the job board) puts the bell in it:
<NotificationBell count={viewer.counts.notifications} />
```

Pages bring their own top on a phone, the way the mockups do: the Forest band on Home, and an app bar with a back
arrow and title elsewhere. Their `<h1>` is the page's only one.

## The links

| | Computer | Phone (names for screen readers only) |
|---|---|---|
| Customer | Home `/` · My jobs `/dashboard` · Messages `/messages` · **Post a job** button | Home · Post a job `/jobs/new` · My jobs · Messages · Account `/profile` |
| Tradie | Find work `/jobs` · My work `/dashboard` · Earnings `/earnings` · Messages | Find work `/jobs` · All jobs `/jobs?view=all` · My work · Messages · Account |

- **Current page:** the most specific link wins. `/jobs?view=all` is All jobs, not Find work. A job's own page
  (`/jobs/TM-1005`) stays on Find work for a tradie. On a phone, Earnings and the account pages light up Account.
  Pages that aren't in the nav (Notifications, Help) light up nothing.
- **Customers' second phone icon is Post a job.** The mockup draws a search icon there, but customers have no
  search page and their home's search box starts a job anyway. Matt chose this on #84. Global search (#243) goes
  in the computer's nav, before "Post a job".
- **Full-screen flows** have no bottom bar: post a job, estimate, extra work, finish job, booking and pay
  (`isFullScreenFlow`). They use Close (×) instead.

## Behaviour

- **M16:** the current link's bar slides and resizes to the new one. It's the signature colour under the link on a
  computer, and a 28px action-colour bar over the icon on a phone. The current icon is also filled.
- **M20:** a count badge pops when the number goes up, never when it goes down. Screen readers hear the count in the
  link's name ("Messages, 3 unread"), not from the badge. Counts over 99 show "99+".
- **Safe area:** the bottom bar pads itself by `env(safe-area-inset-*)`. The `(app)` layout sets
  `viewport-fit=cover` so those insets are real on iPhones. A spacer of the same height ends every page, so nothing
  is ever hidden behind the bar. The top nav sets `scroll-padding-top`, so a focused field never sits under it.
- **Avatar menu:** the kit's `<Menu>`. Its header is the person's name and email, and its items are Account,
  Payments (customers only), Notification settings and Help, then Log out in red. Log out submits a POST form to
  `logOutAction`, never a link.
- **Bell:** a link to `/notifications` with the unread count. The dropdown panel replaces it in #179.

## Tests

- `tests/unit/app-shell.test.tsx` covers:
  - the links against the sitemap;
  - which link is current;
  - full-screen flows;
  - counts and their names;
  - the menu items;
  - what the server sends (never the user id) and what happens when it can't read the extras;
  - the HTML order (skip link first);
  - the test-mode banner;
  - mode colours;
  - the CSS for the safe area and the breakpoint.
- `tests/e2e/dev-app-shell.spec.ts` covers:
  - axe at 320 / 390 / 768 / 1024 / 1440 for four people, with no sideways scroll and the right nav at each width;
  - the skip link;
  - M16 on both navs;
  - the end of the page staying above the bottom bar;
  - 44px targets;
  - M20;
  - the avatar menu by keyboard;
  - full-screen flows;
  - test mode;
  - 200% text.

  It runs against `npm run dev`:
  `E2E_DEV_BASE_URL=http://localhost:3000 npx playwright test tests/e2e/dev-app-shell.spec.ts`.

## Notes for review

- **William:**
  - `src/server/app-shell.ts` runs one query per app page: the last name, plus a count of the person's own unread
    notifications.
  - `paymentsInTestMode()` is always true until the payments work adds a real switch.
  - The `(app)` layout sets `viewport-fit=cover`.
  - The unread messages count is 0 until there's a messages table.
- **Matt:**
  - The customer's Post a job phone icon (above).
  - The test-mode strip's wording: "Test mode. No real money moves."
  - The message count badge on the computer's Messages link. The mockup has no unread there, so it doesn't show
    one.
