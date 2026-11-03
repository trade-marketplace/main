# Job data views

`src/server/views/` is the boundary between private job records and data sent to a page or API. Pass a viewer from
the server auth guard. Never accept a role or user id from request JSON, and never spread a Prisma row into a response.

| Reader | Projection | Location and contacts | Money |
|---|---|---|---|
| Owning customer | `customerJobView`, `customerJobListView`, `customerJobsView` | Own address; assigned worker's phone only during a claimed status | Published total and GST; no estimates, averages, worker pay or margins |
| Tradie | `workerJobView`, `workerJobListView`, `workerJobsView` | Stored approximate pin before claiming; exact address and customer phone only for the current assignment in a claimed status | Their gross plus holiday pay when bookable/assigned; never the customer price |
| Office | `officeJobView`, `officeJobListView`, `officeJobsView` | Full relevant job location and contacts | Full named stored pricing and estimates |
| Public | `publicJobView` | No job data | None |

List projections omit description, address and contacts. Detailed worker projections expose only that worker's own
blind estimate. All projections build explicit allowlists, including nested relations, and convert dates to strings.
Auth tokens, Storage paths and arbitrary new ORM fields are never forwarded by these job projections.

For a page or API that reads one job, use `requireJobView(db, viewer, id)`: its owner/publication constraint is inside
the database query and inaccessible or missing ids both call `notFound()` (404). `loadJobView` provides the nullable
form. A tradie can read open `REVIEW`, `QUOTE_BOUNTY`, `BOOKABLE` jobs and their own assignments. `PRICED` jobs awaiting
the customer are private. Re-read the current row for every request; do not cache a view across requests or sessions.

Private worker access requires **both** the current `workerId` and status `ASSIGNED`, `SUBMITTED`, `COMPLETED` or
`CANCEL_REVIEW`. A retained worker id on `CANCELLED`, or on a stale pre-claim row, never preserves address/phone access.
After reassignment the old worker receives 404 for a private job; after reopening they receive the public worker tier.
Worker titles/descriptions reuse the existing phone/email redactor whenever private access is false; the owning
customer, office and authorized current assignee retain the original text. Historical payout labels also redact
phone/email because a payroll record does not establish current job-contact access. Structured address fields are
gated, but identifying addresses in arbitrary prose or images needs a separate content policy ([#471](https://github.com/trade-marketplace/main/issues/471)).

The approximate pin is the existing cryptographically random point saved when the job location is posted. Reads do
not generate jitter, because repeated samples can reveal the address. An absent, invalid or out-of-range saved pin
produces `null`, with no exact-coordinate fallback. `jobPinFor()` uses the same assignment/status rule and validates
that the persisted point is 100–300 metres from the actual location.

Existing integration points: office job detail/list/CSV, checkout, Earnings/statement job references, message thread
job headers/pickers, and photo access. `jobThreadContextView` keeps message access restricted to current participants
(an open job is not permission to read its conversation). The existing message contact redactor also uses the shared
claimed-status predicate, so cancelled jobs with retained worker ids hide contact text again.
Photo access retains the existing private Storage policy (open jobs/current assignment/owner/office); removing EXIF,
private buckets and short-lived signed URLs remain in the file service. Foreign photo-upload ids return the same 404
as missing ids. `workerPayoutView` preserves a worker's own payroll history after reassignment while returning only
the job number/title. Waiting Earnings records require the current assignment and `ASSIGNED`/`SUBMITTED` status.

Internal pricing, status transitions, payment preparation, notifications and payout calculations retain their private
server models. Their authorized command receipts contain identifiers only; they must not be used as job read DTOs.
No schema migration or new encryption/fuzzing key is required. Future job screens should consume these projections.

The guarded `/dev/components/job-views?state=…` page uses fictitious records for role, revocation, cancelled, missing-pin,
public, loading and error examples. Unit snapshots cover every role in all nine statuses; database tests check real
ownership and assignment changes between requests.
