# Job status machine (#93)

`src/server/jobs/status-machine.ts` is the one place a job's status changes. Nothing else should write
`jobs.status`; screens, server actions, the payment webhook and scheduled jobs all call it.

```ts
import { transitionJob } from "@/server/jobs/status-machine";

// In a server action built with withRole(["TRADIE"], …):
const change = await transitionJob(getDb(), deps, {
  jobId,
  transition: "claim",
  actor: { role: viewer.role, userId: viewer.userId },
});
```

- `transitionJob(db, deps, request)` opens its own transaction. `applyTransition(tx, deps, request)` does the same
  inside a transaction the caller already has (e.g. sending evidence and submitting in one go).
- `decideTransition(job, request, facts)` is the pure rule check, with no database. Use it to decide whether to show
  a button; the real call still checks again.
- It returns a `JobStatusChange` (job, from, to, worker before/after, actor, reason).

## Who is acting

`actor` is `{ role, userId }` for someone signed in (the `Viewer` from `withRole`, role read from `profiles`) or
`{ role: "SYSTEM", source }` for the payment webhook and scheduled jobs. The role picks the kind:
CUSTOMER → customer, TRADIE → worker, ADMIN → office, SYSTEM → system. A customer can only act on their own job and
a worker can only submit the job they claimed.

## Transitions

| Transition | From | To | Who | What must be true first |
|---|---|---|---|---|
| `send-to-bounty` | REVIEW | QUOTE_BOUNTY | office, system | Nothing. ⚑ see "Still to decide" |
| `send-price` | REVIEW, QUOTE_BOUNTY | PRICED | office, system | The job has a price and a `job_pricing` row (`priceJob`, #94) |
| `mark-paid` | PRICED | BOOKABLE | system | A `JOB` payment is `PAID` (the payment webhook calls this) |
| `decline-price` | PRICED | CANCELLED, or CANCEL_REVIEW if money is held | customer | Their job. A reason when it goes to review |
| `cancel` | REVIEW, QUOTE_BOUNTY, PRICED | CANCELLED, or CANCEL_REVIEW if money is held | customer | Their job. A reason when it goes to review |
| `cancel` | BOOKABLE, ASSIGNED | CANCEL_REVIEW | customer | Their job, and a reason |
| `claim` | BOOKABLE | ASSIGNED | worker | Not their own job. Restricted work (any trade but Other) needs a `VERIFIED`, unexpired licence for that trade (DECISIONS.md 1) |
| `submit` | ASSIGNED | SUBMITTED | worker | They're the job's worker, their evidence is sent (`submitted_at`), and no extra work is REQUESTED or PRICED |
| `sign-off` | SUBMITTED | COMPLETED | customer | Their job |
| `auto-sign-off` | SUBMITTED | COMPLETED | system | `settings.auto_release_hours` (48) since the evidence was sent, and no OPEN problem report |
| `approve-cancel` | CANCEL_REVIEW | CANCELLED | office | A reason |
| `reinstate` | CANCEL_REVIEW | the status before CANCEL_REVIEW (from `job_status_history`) | office | A reason |
| `override` | any | any other | office | A reason. Optional `workerId` to reassign |

**Money held** means any payment on the job (job, quick look, extra work) is `PAID` or `PARTIALLY_REFUNDED`. BOOKABLE
and ASSIGNED jobs always count as paid. So a customer who paid the $30 quick look and then cancels or says no to the
price goes to the office's Cancellations queue rather than straight to CANCELLED.

**CANCEL_REVIEW keeps the worker.** A claimed job that the customer asks to cancel keeps its `worker_id`, so the
worker sees "On hold" (sitemap.json `job_statuses`). `reinstate` puts it back to ASSIGNED with the same worker.

**Override** moves to any status but the current one (or the same status with a different worker, i.e. reassign).
Moving to REVIEW, QUOTE_BOUNTY, PRICED or BOOKABLE takes the worker off the job. The database still applies its own
rules (a PRICED job needs a price, an ASSIGNED one a worker), so an impossible override fails and changes nothing.

Not status changes, so not here: re-pricing a PRICED job (`priceJob`), extra work (its own `variations` status),
booking a window, refunds and payouts (payments / payroll modules).

## Refusals

Every refusal throws a `JobTransitionError` (with `code`, `jobId`, `transition`) and changes nothing:

| Class | `code` | When |
|---|---|---|
| `JobNotFoundError` | `job-not-found` | No such job |
| `IllegalTransitionError` | `illegal-transition` | The transition doesn't start from the job's status (`from` says what it is) |
| `TransitionForbiddenError` | `forbidden` | Wrong kind of actor, or not their job |
| `TransitionPreconditionError` | `precondition-failed` | `failure`: `reason-required`, `not-priced`, `not-paid`, `licence-required`, `own-job`, `evidence-not-sent`, `extra-work-open`, `problem-open`, `sign-off-not-due`, `no-target`, `same-status` |
| `JobTransitionConflictError` | `conflict` | The job changed under it five times running. Try again |

A database error (a check constraint or trigger) is passed through unchanged and also rolls everything back.

## One transaction, and two people at once

Each transition runs in one transaction:

1. `set_config('app.actor_id', <user id or ''>, true)`: the history trigger (`record_job_status`) records who made
   the change, and the audit log's actor defaults to it. Empty for the system.
2. Read the job and only the facts its preconditions need, then decide.
3. Update the row **only while it's still what was checked**: `UPDATE … WHERE id = $1 AND status = <read status> AND
   worker_id = <read worker>`.
4. Write the audit entry and queue notifications (below).

When two people act at once, Postgres makes the second update wait for the first's row lock and then re-checks its
`WHERE` against the committed row. It no longer matches, so the loser reads the job again and is decided against
what the winner left:

- **Two workers claim:** one gets the job; the others get `IllegalTransitionError` (it's ASSIGNED now).
- **Customer cancels while a worker claims:** if the cancel lands first, the claim is refused. If the claim lands
  first, the cancel becomes a request to cancel the claimed job (ASSIGNED → CANCEL_REVIEW). Either way the customer's
  cancel is never lost.

Both are tested against a real Postgres in `tests/unit/jobs-status-machine.test.ts`.

## After-effects (injected)

Audit (#100) and notifications (#98) are built separately, so the machine takes them as functions and calls them
inside the transaction, after the status change. If either throws, the status change rolls back too.

```ts
const deps: StatusMachineDeps = {
  // (tx, entry: JobAuditEntry) → write audit_log: actorId, action ("job.claimed"…), recordType "jobs", recordId,
  // before/after { status, workerId }, reason.
  audit: writeAudit,
  // (tx, change: JobStatusChange) → queue the right notifications for the customer / worker / office.
  notify: queueJobNotifications,
};
```

Audit actions: `job.bounty_posted`, `job.priced`, `job.paid`, `job.price_declined`, `job.cancelled`,
`job.cancel_requested` (cancel or decline that went to review), `job.claimed`, `job.submitted`, `job.signed_off`,
`job.auto_signed_off`, `job.cancel_approved`, `job.reinstated`, `job.status_overridden`.

The history row itself needs nothing from the caller: the existing trigger writes it from `app.actor_id`.

## Still to decide (flagged, not invented)

These follow the sitemap and spec as written; the business rule behind them is in DECISIONS.md "Still to decide".

- **Bounty expiry (#193)** and the customer saying no to the $30 look: no transition. The QUOTE_BOUNTY office queue
  is already "AI pricing review", and the spec says "Expired → the office decides", so an expired bounty stays
  QUOTE_BOUNTY until the office prices it, cancels it or overrides it.
- **First dibs** for the quoter (needs the "fair quote" thresholds): not built. `claim` is open to everyone eligible.
- **Who sends the price** (AI pricing model): `send-price` and `send-to-bounty` allow the system as well as the
  office, so an AI pricer can use them later. #279 may replace bounties altogether.
- **Restricted work** (legal check): `claim` requires a `VERIFIED` licence that hasn't expired (by UTC date). If the
  lawyer says "on file" means PENDING is enough, change the licence query in `loadFacts`.
- **Quick look refunds:** a paid quick look sends a cancel or decline to the office's review rather than deciding
  whether the $30 is kept.

## Wiring still to do (other issues)

- #100: pass the real audit helper as `deps.audit`.
- #98: pass the notifier as `deps.notify`.
- #61 (pg_cron): call `auto-sign-off` for SUBMITTED jobs due a release.
- Payments webhook: call `mark-paid` when Stripe confirms the job payment.
- Screens (C08/C09, C17, D-claim, D11, C14, F05, F06): call the transitions from `withRole` actions.
