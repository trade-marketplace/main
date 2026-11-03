# Office pricing workspace

Issue #168 / F02: `/admin/jobs/[id]/price`, stacked on #474. Desktop source: `pages.html#w-o-price`;
phone source: `screens.html#off-price`. Both retain their own descriptive copy below/above the shared 600px breakpoint.
The existing kit supplies fields, tables/cards, dialogs, photo viewer, status feedback and focus behavior.

`pricing-read.ts` authorizes the verified office viewer before any read and projects through #95's `officeJobView`.
Every estimate is visible, including clearly marked estimates made before an edit; those and site-visit-only requests
are excluded from descriptive averages. With at least three current numeric estimates, each numeric column drops one
highest and one lowest before averaging; one or two use their ordinary average. Counts/ratings are actual completed
jobs and non-hidden reviews. Job photos keep the existing private, expiring Storage signing boundary.

The server computes and formats every monetary result with `priceWork`. The browser sends decimal input strings and
renders the returned breakdown; it does not import the pricing engine. Preview does not write pricing or job state.
Existing REVIEW drafts use their saved rate snapshot; otherwise rates come from Settings. Confirmation displays only
job title/suburb and customer total/GST, with no worker pay, estimates, margin or office note.

Publish locks the job, then takes the existing office-user capability lock `(178, 1)` and re-reads the actor's current
ADMIN role. A removal that wins first denies the write; an authorized transaction holds capability through commit.
For a new price using live Settings, publication next takes a native `FOR SHARE` lock on Settings through commit.
An earlier Settings save finishes before rate validation; a later save waits until the exact confirmed price commits.
The read lock never updates Settings' revision/timestamp. Saved REVIEW rate snapshots remain independent of Settings.
The database-client factory binds schema metadata to each client so the raw lock targets the same relation as its ORM
queries, including disposable test schemas, without changing connection/pool options or relying on SQL `search_path`.
The confirmation digest covers the exact inputs, rates, breakdown, draft and job content/photo version. Changed
inputs/rates/content require another explicit confirmation. The trusted server passes those rechecked rates to
`priceJob`'s optional `confirmedRates` argument, avoiding a second settings sample. Pricing, status-machine `send-price`,
audit and the customer's durable in-app notification commit together. Audit request IDs make retries idempotent;
refusals/replays roll the lock write back. Queue reads are revalidated after success.

This workspace and its commands are read-only from PRICED onward, including paid/assigned/closed jobs. Stored values
are displayed directly, even if Settings later changes. The older explicit job-admin Edit price operation retains its
existing unpaid repricing permission; #177's settings edits still never rewrite saved snapshots.

“Ask for more photos” creates/reuses the canonical shared job conversation under that same job lock, records thread
and message audit entries and notifies only the customer. Only the office-entered message is posted; no builder,
estimate, margin or internal-note text is appended. The existing customer/current-assignee/office conversation policy
applies, including normal later-assignee visibility of ordinary messages. Legacy private threads are never merged or
opened, and internal notes remain office-only. The existing customer message/reply/photo-upload path is reused.

DECISIONS.md leaves automated disagreement/fairness thresholds and paid-visit automation unresolved. The workspace
shows factual ranges, descriptive averages and existing visit requests for office judgment. It does not claim a spread
is “safe” or invent a disagreement threshold. “Needs a site visit” explicitly explains the future paid quick look and
hands off to the working photo-request composer; it books/charges nothing. The separate #279 proposal is not adopted.

Guarded examples: `/dev/components/office-pricing?state=ready|no-estimates|site-visit|loading|error|offline|confirm|photos|sent|frozen|long|changed`.
`long&invalid=1` combines long/stale content with server validation for bot capture. A guarded, fictitious-only preview
POST calculates examples on the server without a database; real actions remain protected by ADMIN `withRole`.
Both the page and preview POST are unavailable in deployed environments. Local examples never contact real services.

New wording or wording used in a new context is listed in the PR for Matt, including the shared conversation visibility,
factual spread guidance, explicit future visit explanation, confirmation/success/read-only messages and field errors.
