# Office navigation (admin shell)

Issue #85. Code: `src/components/office`. The nine links and current-section matching live in `office-links.ts`;
the server loader is `src/server/office-shell.ts`. The guarded preview is `/dev/components/office-shell`.
This is the frame for office pages; it does not build the queues, tables or individual admin pages.

| Where | What | Reference |
|---|---|---|
| From 1024px | A 240px Forest sidebar, Mint current-page marker and badges, wordmark, Office label and avatar menu | `pages.html#w-o-queues`, `screens.html#off-queues`, `web.css` office rules |
| Under 1024px | A Forest top bar with an Office menu button and avatar menu | `FRONTEND_SPEC.md` office shell behaviour; existing Menu and Button kit |
| Everywhere | Skip link first, gold test-mode strip while enabled, and one focusable `<main id="main">` | #85; the shared app shell pattern from #84 |

## Using it

Every page under `src/app/admin/` inherits `src/app/admin/layout.tsx`, which wraps its content in `<OfficeShell>`.
The shell calls `requireRole(["ADMIN"], { next: "/admin" })` before loading or rendering any office content. The
proxy also protects these routes; individual page reads and actions must retain their own authorization checks.
The layout sets `viewport-fit=cover` and asks search engines not to index the office.

```tsx
// The /admin layout already does this:
<OfficeShell>{children}</OfficeShell>

// Previews and tests can supply the display data directly:
<OfficeShellView
  viewer={{ role: "ADMIN", firstName: "Matt", lastName: "Larsen", email }}
  counts={{ queues: 9, tradies: 3, support: 2 }}
  testMode
>
  <h1>Office page title</h1>
</OfficeShellView>
```

`OfficeShellViewer` contains only identity display data: role, first name, optional last name and email. Counts
are a separate prop on `OfficeShell` and `OfficeShellView`, with zero defaults when no counts are supplied.
`OfficeCounts` has exactly three keys: `queues`, `tradies` and `support`. The shell displays supplied values; it
does not query or calculate them. Pages supply their own heading and content inside the shell's main; do not add
a second `<main>`. The shell explicitly sets `data-mode="office"`, including when previewed without a session.

## The links

The order and URLs match `sitemap.json` → `navigation.office`:

| Key | Label | URL |
|---|---|---|
| `queues` | Queues | `/admin` |
| `jobs` | All jobs | `/admin/jobs` |
| `tradies` | Tradies | `/admin/tradies` |
| `customers` | Customers | `/admin/customers` |
| `payouts` | Payouts | `/admin/payouts` |
| `payments` | Payments | `/admin/payments` |
| `reviews` | Reviews | `/admin/reviews` |
| `support` | Support | `/admin/support` |
| `settings` | Settings | `/admin/settings` |

`currentOfficeLink()` treats `/admin` as an exact match, so it does not stay current on every admin page. Queue
work and its nested pages select Queues: `/admin/jobs/[id]/price`, `/admin/variations` (including individual
variations), `/admin/disputes`, `/admin/signoff` and `/admin/pricing`. The job ID must be one nonempty path segment.
These matches take priority over the general section match, so pricing a job selects Queues while
`/admin/jobs/TM-1005` selects All jobs. Other nested records retain their section. Matches respect path boundaries:
`/admin/jobs/TM-1005/price-history` remains All jobs, and `/admin/pricing-guide` selects nothing. Trailing slashes,
query flags and fragments do not affect matching; unrelated paths select nothing.

## Behaviour and shared components

- **Current page / M16:** the active link has `aria-current="page"`, a Mint tint, filled icon and Mint marker at
  its left edge. The shared `useTabIndicator` hook now accepts an optional `"y"` axis for the sidebar; its default
  horizontal behaviour is unchanged. The existing motion tokens and reduced-motion handling still apply.
- **Counts / M20:** the existing `NavCount` renders badges only for positive, finite counts. Above 99 the badge and
  accessible label say `99+`. The label says, for example, "Tradies, 3 waiting"; the decorative badge is hidden
  from screen readers. Only Queues, Tradies and Support can have badges. The shared badge pops when a count
  increases.
- **Phone menu:** the kit's `Menu`, `MenuItem` and `Button` provide opening by Enter, Space or arrow keys, arrow-key
  navigation, Home/End, and Escape to close and restore focus to the trigger. Tab dismisses the menu. The office
  menu scrolls vertically if it cannot fit the viewport. `MenuItem` accepts `aria-current="page"` so the selected
  destination is exposed in this menu too.
- **Avatar:** initials come from the existing `initials()` helper. The menu header shows the full name and email;
  its actions are Help followed by Log out. There is no Account item, `/profile` link or `/admin/settings` link
  in this menu. A personal office profile is a separate later task. Log out submits a hidden POST server-action
  form wired to `logOutAction`, never a GET link. Long names wrap inside the menu. The bottom sidebar avatar
  opens its menu upwards before focus moves, keeping the complete panel in view without scrolling the document.
  The shared Menu's automatic-placement issue is tracked separately in #337.
- **Skip link:** the first focusable element targets `<main id="main" tabIndex={-1}>` and becomes visible on focus.
- **Stays in view:** from 1024px the sidebar is a full screen tall and sticks to the top. On long pages the links
  and the avatar never scroll away. If the window is too short for every link, the links scroll inside the sidebar.
  Below 1024px the Forest top bar sticks to the top. The decorative bolt is anchored to the sidebar's bottom edge,
  so it always bleeds off it as in the mockup.
- **Payment strip:** the existing `Banner` uses test tone and the exact message "Test mode. No real money moves." It sits over the page column (on a phone, under the top bar), not over the sidebar, so the sidebar can stay a full screen tall.
  `OfficeShell` reuses `paymentsInTestMode()` from `src/server/app-shell.ts`; it remains true until the payments
  work adds an approved live-mode switch. A preview flag only affects the preview.

## Counts contract

Matt confirmed the following meanings for the supplied values:

| Prop | Meaning |
|---|---|
| `queues` | To price + Extra work + Cancellations + Sign-off + Unclaimed > 48h, counted per task; one job needing two actions contributes two |
| `tradies` | Tradies waiting to be checked |
| `support` | Open support threads |

All jobs, Customers, Payouts, Payments, Reviews and Settings never display a badge. The shell does not infer
these numbers from job statuses or run any counting queries. The Queues page issue (#167) owns the counting
queries and their integration. This issue supplies the display contract, zero defaults and dev-page examples.

## Server identity data

`getOfficeShellViewer()` caches the identity data for a request. `loadOfficeShellViewer(viewer, sources)` accepts
fake sources in tests and returns null for signed-out, customer and tradie viewers before calling those sources.
`findOfficeShellExtras(userId, database?)` accepts a fake database; production obtains `getDb()` lazily.

The loader selects only the person's last name; it never reads queue, licence, payout or support data. It sends
no profile ID or authorization fields to the shell. If the optional profile data is missing or a read fails, the
shell retains the known first name and email. Unexpected errors are logged; an unconfigured local database does
not produce a log on every page. Identity-loading failures do not change counts supplied by the caller.

## Preview states

`/dev/components/office-shell` calls `guardDevPage()` before reading its query flags. Its names and counts are
examples only. Normal production deployments return 404; the existing screenshot-workflow guard allows the bot
to capture these examples in its isolated run.

| Flag | Values / example |
|---|---|
| `counts` | `none`, `some` (default), `many` (99+ badges) |
| `menu` | `open` opens the Office menu below 1024px |
| `account` | `open` opens the avatar menu |
| `test` | `off` hides the payment strip; otherwise it is shown |
| `at` | `/admin/tradies`, or another recognized admin section/nested path |
| `name` | `long` shows a long name and email |

For example: `/dev/components/office-shell?counts=many&at=/admin/tradies&menu=open&name=long`.
Office links in the preview preserve the chosen count, test-mode and name examples while changing `at` and
closing any initially open menus. The preview includes only a content placeholder and controls, not queue pages.

## Measurements and review

Both supplied references were inspected. `pages.html#w-o-queues` is a 1440px desktop frame with a 248px sidebar;
`screens.html#off-queues` is also a desktop frame, with a 240px sidebar. Neither is a drawn phone office shell.
The implementation follows the user's explicit 240px requirement and the phone top-menu behaviour in the spec.
The remaining desktop measurements come from `w-o-queues`: 22px top / 12px horizontal sidebar inset, a 26px-high
wordmark, 42px navigation rows separated by 2px, 21px icons and 14px link text. These are documented differences
between the references, not an assertion that the complete queue page has been implemented.

Screenshots at 1440 and 390 should compare the shell against these references; the main content is deliberately
a preview placeholder because #85 excludes building the queue pages.

## Tests

- `tests/unit/office-shell.test.tsx`: sitemap order and URLs, current sections, count labels, HTML order, mode,
  banner, initials, avatar actions, logout form, and server authorization before rendering children.
- `tests/unit/office-shell-server.test.ts`: the profile-only database query with fakes, no counting queries,
  unauthorized viewers, missing profiles, failed reads and the absence of private identifiers in display data.
- `tests/e2e/dev-office-shell.spec.ts`: axe and no sideways scroll at 320 / 390 / 768 / 1024 / 1440; menu keyboard
  behaviour and focus return; skip link; sidebar width and M16 marker; count states; avatar menu; test mode; long
  names and 200% text. It also checks that the dev route is 404 in a normal production build.

Run the dev checks against a running Next development server:

```sh
npx next dev --hostname 127.0.0.1 --port 3000
# In another terminal:
E2E_DEV_BASE_URL=http://127.0.0.1:3000 npx playwright test tests/e2e/dev-office-shell.spec.ts
```

William reviews the admin guard and identity-data boundary; Matt reviews the shell geometry, phone menu, colours
and copy. All normal repository checks still apply before a completed PR.
