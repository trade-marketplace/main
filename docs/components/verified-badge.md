# Verified worker badges (#136)

`isVerified(worker, trade?, now?)` in `src/server/workers/verification.ts` is the single badge rule. Use
`WORKER_VERIFICATION_SELECT` for fresh server reads, or `verifiedBadgeFor(db, userId, trade)` to get only a boolean
and mark the calling page dynamic.
Never cache a badge, infer it from the legacy `verifiedAt` flag, or send contact/identity proof fields to a client.

A badge needs the current confirmed email, confirmation bound to the actual E.164 phone, an explicit office ID
check (time + office actor), and no office pause. For restricted trades, the selected trade also needs its own
VERIFIED licence, check time/actor and a known expiry on or after today in Pacific/Auckland. Missing data fails
closed. A generic profile badge requires all advertised restricted trades to pass; an electrical licence never
lends a badge to an unchecked plumbing trade. Other has no licence claim. Badge rules are deliberately separate
from the complete job eligibility policy (#137).

Pass `{ verified: isVerified(worker, trade), trade }` into the `verification` prop of `ProfileCard` or `WorkerCard`.
The shared `VerifiedBadge` says “Licence checked” only for a restricted trade; its generic/Other label is “Verified”.
Public profile loaders must also reject paused/removed profiles and avoid static caching (A12). Public profile,
worker-directory and booked-panel routes will consume these components in their own issues; no public route is
invented here. The guarded `/dev/components/verified-badge?state=` page demonstrates all three surfaces and cases.

`recordWorkerCheck` is a server-only, audited office recording primitive. It implements neither SMS nor a new
phone/ID confirmation policy: its caller must establish trusted proof first. A changed phone clears its stored
confirmation in the database. No old generic flag is backfilled into identity or phone evidence. Office pause
is separate from the worker's own availability switch. Both fresh claim facts and a database assignment trigger
reject paused workers; the row lock serializes a pause with an in-flight claim. Work already assigned may finish.
