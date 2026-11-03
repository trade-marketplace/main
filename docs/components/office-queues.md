# Office queues

Issue #167, F01, `/admin`. Design: `pages.html#w-o-queues`; shared `DataTable`, `Tabs`, `CountUp` and office shell.
The branch is stacked on #472 (#95); its PR base is `feat/95-job-views` until founders merge the dependency.

The five designed tabs stay intact. The series plan's additional “Waiting on customer” links to the existing
All jobs `PRICED` filter. “Problems” is a separate paginated case list opening existing job-admin pages; an open
problem is never reclassified as a cancellation.

| Queue | Counted work | Clock and ordering | Existing action destination |
|---|---|---|---|
| To price | REVIEW / QUOTE_BOUNTY jobs | Latest entry into these states; oldest first | `/admin/jobs/[id]/price` when current estimates exist; otherwise Open |
| Extra work | Each REQUESTED variation on a non-closed job | Variation creation; oldest first | Job admin |
| Cancellations | CANCEL_REVIEW jobs | Latest cancellation-review entry; current request reason only | Job admin |
| Sign-off | SUBMITTED jobs | Submitted evidence, falling back to latest status entry for an office override | Job admin |
| Unclaimed > 48h | BOOKABLE, no worker, latest BOOKABLE entry at least 48h ago | Latest BOOKABLE entry; a recent re-entry resets the clock | Job admin |

Urgency is a display flag: 24h for pricing/extra/cancellation work and the configured auto-release interval for
sign-off (48h by default). Unclaimed uses the existing 48h scheduler threshold. Open problems pause sign-off
urgency and auto-release. A status override with missing evidence still ages consistently on both row and card,
but never contributes to the “auto-release today” figure. Evidence and override clocks are merged before stable
ID ordering and pagination, so an older override cannot be hidden behind newer evidence. That figure uses submitted evidence and the current
scheduler eligibility, compared by New Zealand calendar day, including daylight-saving changes. No scheduler,
pricing, payment or status-transition rules are changed here.

`src/server/office/queues.ts` owns the shared predicates, counts and paginated reads. `src/server/views/office-queues.ts`
builds the explicit office row projection through #95's role boundary. Current estimates determine the count and
spread; stale estimates are excluded. Email/phone can match the server search but are never selected into result
rows. Job number, title, suburb, customer/tradie names and full names also match; formatted NZ mobile numbers are
normalized before querying. Every public read checks the trusted ADMIN viewer before touching the database.

The URL stores `tab`, `q`, `page` and `problemPage`, so refresh and browser Back preserve context. Selecting a KPI
or tab clears pending/local search and cancels its timer. Slash focuses search only outside inputs, contenteditable
areas, menus and dialogs. Search-empty can clear back to the current queue. The Problems anchor and section always
have the same visibility. Offline input stays in memory; reads resume when online, and network row actions disable.

The existing Matt-approved sidebar contract remains: Queues is the sum of the five queue task counts (two requested
variations on one job count twice), Tradies counts distinct worker profiles awaiting office checks, Support counts
open threads. Header work totals additionally include open problem cases. The shell/page deduplicate counts with
request-local React cache. Count failures hide unknown badges; the queue page shows its error state and placeholder
counts rather than reporting all-clear zeros. No cross-request private cache, new database table or migration.

#168 connects the To price row action to the dedicated `/admin/jobs/[id]/price` workspace. That route preserves the
login return path, authorizes office access and presents saved jobs read-only. The older narrowly guarded
`dialog=price` job-admin handoff remains compatible for existing callers. Other actions still open existing job admin.

Guarded preview: `/dev/components/office-queues?state=price|extra|cancel|signoff|unclaimed|all-clear|loading|error|offline|search|search-empty|long`.
Production deployments return 404 there. All examples are fictitious. The bot captures every state at 1440/390; local
checks also cover 320/768/1024, keyboard menus/tabs/search, rapid search→queue switches, actual signed-in row actions
and Back, true status ages, settings-driven sign-off and current-request reasons against disposable PostgreSQL.

Screen wording follows both mockups and the existing kit. Below the shared 600px phone breakpoint, KPI cards
use screens.html#off-queues’ “Extra work to price”, “Cancel requests” and “Waiting sign-off”; desktop cards and
the prescribed tabs keep “Extra work”, “Cancellations” and “Sign-off”. Hidden label variants leave the accessibility tree. Additional layout labels for Matt's review: “Waiting on customer”,
“Problems”, “Problem”, “Reason”, “Auto-release”, “Search jobs and people”, “Search results”, “Queue totals”, “Other work”,
“Queue jobs”; singular header “1 thing needs you”. Empty/error/offline/retry wording reuses existing components.

The Unclaimed KPI detail uses the oldest still-qualifying job's actual suburb, as in `pages.html#w-o-queues`.
Its job is rechecked against the same unclaimed predicate and passed through the central office list projection;
only the suburb reaches that detail line. The existing status-entry clock still controls ordering and urgency.
An empty queue shows the neutral dash; a changed/missing oldest row fails visibly for retry rather than inventing a detail.

Below the shared 600px breakpoint, non-empty KPI details use the phone mockup's “Needs you” (price,
extra work, cancellations and unclaimed) or “Waiting” (sign-off). Empty and unavailable/loading counts keep
“—”; desktop retains the actual age, release detail or oldest suburb. Hidden variants are not accessible names.
