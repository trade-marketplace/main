# Cards, tiles and rows

Issue #76. Code: `src/components/cards` (import from `@/components/cards`); the rules behind them (the
categories, initials, the tile's distance line) are in `src/lib/cards.ts`. Every variant and state, live:
`/dev/components/cards` (dev only), with `?mode=trade|office`.

| You need | Use | Spec |
|---|---|---|
| A job on the tradie's board: photo, what they earn, distance, Save | `<JobTile>` | components.css `.tm-tile`; screens.html tr-home, tr-all; pages.html w-t-board |
| A kind of work: Electrical, Plumbing, Construction, Gas fitting, Other | `<CategoryTile>` in a `<CategoryRail>` | components.css `.tm-cat` (159 × 162); cus-home, tr-home, w-c-home |
| A job in a list: My jobs, Your jobs, Needs you, My work | `<JobRow>` | components.css `.tm-jobrow`; cus-myjobs, tr-mywork, w-c-home |
| A count or a sum with a label: office queues, earnings, scorecard | `<KpiCard>` | web.css `.w-kpi`; w-o-queues, w-t-earnings |
| The money card at the top of Earnings on a phone | `<StatCard>` | tr-earnings |
| "4.9 rating · 32 jobs · 2024 joined" | `<StatStrip>` | sh-tradie-public, w-profile-public |
| A tradie's public face | `<ProfileCard>` | sh-tradie-public (plain), w-profile-public (card) |
| A section with nothing in it yet | `<EmptyCard>` | `.tm-empty` in a flat card; sys-empty |

## The rules every card follows

- **One link per card** (FRONTEND_SPEC). The title is the link, in a heading, and its `::after` covers the card,
  so a click anywhere opens it while a screen reader hears just the title. Save on a job tile and a row's one
  `action` button sit above it and work on their own. Nothing else inside a card may be a link or a button.
- **Hover: M03.** Linked cards rise 2px with a deeper shadow; a tile's photo zooms 1.04. It's `.tm-lift` and
  `.tm-zoom__img` from `src/styles/motion.css`, so reduced motion is handled there. Greyed-out cards don't lift.
- **Long text never spills.** Tile titles take two lines under the distance line (three in all), row titles one,
  each ending in "…" with the whole text as the tooltip and the link's name. Names and notes on KPI and profile
  cards wrap. At 200% text or on a small phone, a row's price and button move under the job.
- **No photo:** Forest with the bolt (FRONTEND_SPEC "Missing photo"). Photos are decorative (`alt=""`): the title
  says what the job is.
- **Real values only.** Every price, distance, count and name comes from the server. Tradies see what they earn,
  never the customer's price; customers never see estimates (AGENTS.md).

## JobTile

```tsx
<JobTile href={`/jobs/${job.id}`} title="Sub wiring" photo={job.thumbUrl}
  meta={tileMeta(formatKm(job.km), job.suburb)}           // "4 km · Windsor"
  tag={{ kind: "earn", text: "You earn $259" }}           // or { kind: "estimate" } / "estimated" / { kind: "bounty", text: "Bounty $30 · 17h" }
  saved={saved} onSavedChange={setSaved} shape="tall" />
```

`shape`: `square` for the phone's 2-column grid (6px gaps), `tall` (191 × 220) for the desktop board. The tag is
the link's description. Save is a toggle (`aria-pressed`) named "Save Sub wiring"; becoming saved pops it once
(M23) without moving focus.

## CategoryTile

```tsx
<CategoryRail label="What needs doing?">
  {CATEGORIES.map((c) => <li key={c}><CategoryTile category={c} href={`/jobs/new?type=${c}`} /></li>)}
</CategoryRail>
<CategoryTile category="plumbing" disabled="Not verified" />
```

The art, tint and words come from `CATEGORY_INFO` (the 3D art is in `public/images/categories`; Gas fitting and
Other use icons). `disabled` greys it, takes it out of the Tab order and shows the reason as its second line. The
rail scrolls sideways on a phone and wraps from 1024px.

## JobRow

```tsx
<JobRow href={`/jobs/${job.id}`} category="Electrical" title="Sub wiring" meta="Windsor · TM-1005"
  photo={job.thumbUrl} price="$372.00" status={<StatusPill status={job.status} audience="customer" />}
  action={<Button size="sm" width="auto" href={`/jobs/${job.id}#price`}>See price</Button>} />
```

Its layout follows its own width: under 560px it's the phone row (64px photo, pill under the title); from 560px
it's the desktop "Needs you" row (112 × 72 photo, pill above the title, the big price).

## KpiCard, StatCard and StatStrip

```tsx
<KpiCard label="To price" value={4} note="oldest 26h" alert href="/admin?tab=price" />
<KpiCard label="Paid in October" value={3452.8} format={formatNzd} note="14 jobs · holiday pay included" />
<StatCard label="Paid in October" value={3452.8} format={formatNzd} note="14 jobs · holiday pay included" />
<StatStrip items={[{ label: "rating", value: "4.9" }, { label: "jobs", value: "32" }, { label: "joined", value: "2024" }]} />
```

Numbers count up from 0 the first time they're on screen (M17, `<CountUp>`). The page's HTML already has the
final value, and screen readers only hear that. Text values ("94%") are shown as they are. `alert` gives the red
top edge and red note (WEBAPP_SPEC F01: overdue); say why in `note`. `href` makes the whole card open its queue.

## ProfileCard and EmptyCard

```tsx
<ProfileCard name="Jack W." meta="Electrician · Invercargill" variant="card"
  badges={<Pill kind="good">Licence checked</Pill>} stats={[…]} />
<EmptyCard illustration="van" title="Nothing on yet." message="Post it free and we'll get you a price."
  action={<Button href="/jobs/new" width="auto">Post a job</Button>} />
```

Public profiles show the first name and initial only (A12). Without a photo the avatar is their initials (first and
last name). Badge wording must match what the office checked ("Licence checked", never "Certified"). `variant="card"`
is the desktop sidebar card (bigger avatar and name); `plain` is the phone page.

## Tests

- `tests/unit/cards.test.tsx`: the rules in `src/lib/cards.ts`, the HTML each component renders (one link per
  card, headings, descriptions, Save, disabled tiles) and the CSS the design depends on (tokens only, sizes,
  clamping, the red KPI edge).
- `tests/e2e/dev-cards.spec.ts`: axe, no sideways scroll and nothing spilling out of a card at 320 / 390 / 768 /
  1024 / 1440 in all three modes; a click anywhere opens the card; a row's button works on its own; Save by
  keyboard keeps focus; Tab order skips greyed-out trades; M03; long text; the phone rail; 200% zoom. It runs
  against `npm run dev`: `E2E_DEV_BASE_URL=http://localhost:3000 npx playwright test tests/e2e/dev-cards.spec.ts`.

## Notes for review

- **New tokens** (both `tokens.css` files, which must match): `--trade-cat-electrical`, `-plumbing`,
  `-construction`, `-gas`, `-gas-ink` and `-other`, the category tints the mockups use inline.
- Tile tags follow the rendered mockup: "Needs estimate", "Estimated" and the bounty tag are Forest with white
  text (the spec's prose says the bounty chip is gold; the w-t-board mockup shows Forest). "⚡ Estimated" uses the
  bolt icon, not the emoji (FRONTEND_SPEC: no emoji in UI).
- Distances use the app's `formatKm` (whole km, "<1 km"), so tiles say "4 km" where the mockup says "3.6km".
- The phone stat card's big number is the title size (36px), the nearest token to the mockup's ~42px.
- Category art in `public/images/categories` is resized copies of `docs/design/img` (meter, pipe, gun).
