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
  viewer={{ role: "ADMIN", firstName: "Matt", lastName: "Larsen", email, counts }}
  testMode
>
  <h1>Office page title</h1>
</OfficeShellView>
```

`OfficeShellViewer` contains the role, first name, optional last name, email and `OfficeCounts`. `OfficeCounts` is a
record with all nine navigation keys. Pages supply their own heading and content inside the shell's main; do not
add a second `<main>`. The shell explicitly sets `data-mode="office"`, including when previewed without a session.

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

`currentOfficeLink()` treats `/admin` as an exact match, so it does not stay current on every admin page. Nested
records retain their section: `/admin/jobs/TM-1005` selects All jobs. `/admin/pricing` and its descendants select
Queues. Trailing slashes, query flags and fragments do not affect matching; unrelated paths select nothing.

## Behaviour and shared components

- **Current page / M16:** the active link has `aria-current="page"`, a Mint tint, filled icon and Mint marker at
  its left edge. The shared `useTabIndicator` hook now accepts an optional `"y"` axis for the sidebar; its default
  horizontal behaviour is unchanged. The existing motion tokens and reduced-motion handling still apply.
- **Counts / M20:** the existing `NavCount` renders badges only for positive, finite counts. Above 99 the badge and
  accessible label say `99+`. The label says, for example, "Tradies, 3 waiting"; the decorative badge is hidden
  from screen readers. The shared badge pops when a count increases.
- **Phone menu:** the kit's `Menu`, `MenuItem` and `Button` provide opening by Enter, Space or arrow keys, arrow-key
  navigation, Home/End, and Escape to close and restore focus to the trigger. Tab dismisses the menu. The office
  menu scrolls vertically if it cannot fit the viewport. `MenuItem` accepts `aria-current="page"` so the selected
  destination is exposed in this menu too.
- **Avatar:** initials come from the existing `initials()` helper. The menu header shows the full name and email;
  its three actions are Account, Help and Log out. Log out submits a hidden POST server-action form wired to
  `logOutAction`, never a GET link. Long names wrap inside the menu.
- **Skip link:** the first focusable element targets `<main id="main" tabIndex={-1}>` and becomes visible on focus.
- **Payment strip:** the existing `Banner` uses test tone and the exact message "Test mode. No real money moves."
  `OfficeShell` reuses `paymentsInTestMode()` from `src/server/app-shell.ts`; it remains true until the payments
  work adds an approved live-mode switch. A preview flag only affects the preview.

## Server data

`getOfficeShellViewer()` caches the shell data for a request. `loadOfficeShellViewer(viewer, sources)` accepts
fake sources in tests and returns null for signed-out, customer and tradie viewers before calling those sources.
`findOfficeShellExtras(userId, database?)` accepts a fake database; production obtains `getDb()` lazily.

The loader reads only the person's last name, then makes three count queries:

| Badge | Source | Meaning |
|---|---|---|
| Tradies | `licence.count({ where: { status: "PENDING" } })` | Per-trade licences waiting for an office check |
| Payouts | `payout.count({ where: { status: "QUEUED" } })` | Payroll records waiting for the next pay run |
| Support | `supportThread.count({ where: { status: "OPEN" } })` | Open threads in the office inbox |

All jobs, customers and settings are not waiting-work queues. Payments and reviews have no pending office-work
state in the current schema, so these badges are zero. The Queues badge has an outstanding definition below.
The server sends no profile ID, licence contents, payout amount or support-message contents to the shell. If the
optional extras are missing or a read fails, the shell retains the known first name and omits badges. Unexpected
errors are logged; an unconfigured local database does not produce a log on every page.

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

## Outstanding requirements — not complete until clarified

- **Queues badge:** a question is posted on #85 about which jobs/actions belong in its aggregate and whether it
  counts unique jobs or waiting actions. The desktop mockup shows a badge of 9 but queue cards totaling 11, so its
  example numbers cannot define the rule. Production currently leaves this badge at zero; preview examples can
  show it. This is an unfinished requirement, not an agreed business rule.
- **Account destination:** the shared `/profile` destination currently excludes ADMIN in the route guard. The
  shell retains the shared Account link while the office destination is being clarified on #85. This is an
  unfinished requirement; it must be resolved before the shell is described as complete.

## Tests

- `tests/unit/office-shell.test.tsx`: sitemap order and URLs, current sections, count labels, HTML order, mode,
  banner, initials, avatar actions, logout form, and server authorization before rendering children.
- `tests/unit/office-shell-server.test.ts`: actual database query shapes with fakes, unauthorized viewers, missing
  profiles, zero/large counts, failed reads and the absence of private identifiers in the display data.
- `tests/e2e/dev-office-shell.spec.ts`: axe and no sideways scroll at 320 / 390 / 768 / 1024 / 1440; menu keyboard
  behaviour and focus return; skip link; sidebar width and M16 marker; count states; avatar menu; test mode; long
  names and 200% text. It also checks that the dev route is 404 in a normal production build.

Run the dev checks against a running Next development server:

```sh
npx next dev --hostname 127.0.0.1 --port 3000
# In another terminal:
E2E_DEV_BASE_URL=http://127.0.0.1:3000 npx playwright test tests/e2e/dev-office-shell.spec.ts
```

William reviews the admin guard, aggregate query definitions and data boundary; Matt reviews the shell geometry,
phone menu, colours and copy. All normal repository checks still apply before a completed PR.
