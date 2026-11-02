# Office: Job admin view

Issue #171 (F05). Route: `/admin/jobs/[id]`. Mockup: pages.html `w-o-job` ("Office · job admin view").

| Part | Code |
|---|---|
| The page (checks the office role, reads one job) | `src/app/admin/jobs/[id]/page.tsx`, `loading.tsx` |
| What the office sees and does | `src/components/office/JobAdmin.tsx` (+ `JobAdminClient`, `JobAdminSkeleton`) |
| The rules for each action, the timeline's words, formatting | `src/lib/office-job.ts` |
| The read: money, messages, merged timeline, tradies to swap in | `src/server/office/job.ts` |
| The changes (one transaction each) | `src/server/office/job-mutations.ts` |
| The server action the dialogs call (office only) | `src/server/office/job-actions.ts` |
| Every state, with a pretend server | `/dev/components/office-job` |

## What it shows

- **Header:** breadcrumb back to All jobs, the title with the office's status word, and
  `Customer → Tradie · Trade · Suburb`.
- **Money:** Customer paid, Extra work (approved), Refunded (once something was), Tradie earns (the job's frozen
  gross pay, `+ extra` when extra work was approved) and Payroll.
- **Messages:** the office's support messages with the customer and the tradie about this job, with **Message both**.
- **Timeline:** newest first, a dot coloured by who did it (customer green, tradie orange, office Forest, system
  grey; screen readers hear the actor's name in words). It merges the audit log (this job, its payments, extra work
  and payouts) with the job's status history, showing a status change once when the audit log also has it. The
  office's note shows under the entry in quotes. The newest 200 entries.

## Actions menu

| Menu item | What it does | Available when |
|---|---|---|
| Reassign tradie | Puts another verified tradie on the job (same status). Audit `job.reassigned` | ASSIGNED, SUBMITTED or CANCEL_REVIEW |
| Refund (full or part) | Records a refund against one payment. Audit `payment.refunded` / `payment.partially_refunded` | A payment has money left |
| Edit price | Re-prices from hours and materials with the job's frozen rates (`priceJob`). Audit `job.priced` | REVIEW, QUOTE_BOUNTY or PRICED (the database freezes the price once paid) |
| Force status | The status machine's `override`, to any status the job can be in. Audit `job.status_overridden` | Always |
| Cancel job | `override` to CANCELLED. Audit `job.cancelled`. Does not refund | Not COMPLETED or CANCELLED |

Every one opens a confirm dialog with a **required note** (up to 500 characters) that is stored as the audit
entry's reason and shows on the timeline. A greyed-out item says why in brackets. In one transaction each action:
locks the job's row, checks the status the office was looking at (`seenStatus`; if the job has moved on the answer is
"This job changed while you were looking. Reload the page and try again."), makes the change through the status
machine or pricing module, writes the audit entry and queues the in-app notifications (cancel: `job.cancelled`;
reassign and force status: `job.status_overridden`, to the customer and both tradies). Any failure rolls all of it back.

**Refunds are a record.** Payments are in test mode, so a refund moves the payment's `refundedCents`, status and
`refundedAt` and writes the audit entry. Nothing is sent to Stripe. The dialog says so. When real payments are
switched on (both founders), sending the refund to Stripe belongs in `refund()` in `job-mutations.ts`.

**Message both** sends the message to the customer and the tradie (if there is one) as the office, in each
person's open support thread about this job (made on the first message). It uses the support tables from Schema 4
(`support_threads`, `support_messages`): there is no customer/tradie chat table yet.

## States

| State | How to see it |
|---|---|
| The job | `/admin/jobs/<id>` as office; preview `?state=default` |
| Not paid, no tradie, no messages | preview `?state=unpaid` (a real REVIEW job looks the same) |
| Paid, nobody has claimed it | preview `?state=no-tradie` |
| Cancelled and refunded | preview `?state=cancelled` |
| Very long names, title and note | preview `?state=long-text` |
| Loading | `loading.tsx` skeleton (M15); preview `?state=loading` |
| Can't load this job | Database down: "Can’t load this job" with Try again; preview `?state=error` |
| Not a job | A 404 for an id that isn't a job |
| Actions menu | preview `?menu=open` |
| Each dialog | preview `?dialog=reassign|refund|price|status|cancel|message` |
| A dialog's error | preview `?dialog=cancel&failure=1` |
| Done | A green banner ("Job cancelled.") and the timeline shows the new entry |

## Tests

- `tests/unit/office-job.test.tsx`: the action rules and every "What if…" (no note, junk input, stale view, job gone,
  nothing to refund, too much), the timeline's merge and words, the money, the page's role check, 404 and
  can't-load, and every state and dialog of the screen.
- `tests/unit/office-job-db.test.ts`: every action against a real Postgres: the data change, the audit entry with
  its note and actor, the notifications, every refusal leaving nothing changed, two cancels at once, and the
  timeline reading the result back.
- `tests/e2e/dev-office-job.spec.ts`: the preview page at all five widths (axe, no sideways scroll), a keyboard
  run-through of the menu and a dialog (required note, Esc returns focus), refund and a failed save.

## Notes for review

- **William:** the actions touch pricing, payments and the status machine. Refunds are a record only. Please check
  `refund()` and `reprice()` in `job-mutations.ts`. The row lock is a no-op update of `jobs.updated_at` (rolled back
  if the action is refused), because Prisma has no `FOR UPDATE` without naming the table. No schema change.
- **Matt:** words the mockup doesn't show, all new and easy to change in `JobAdmin.tsx` / `office-job.ts`:
  - **Force status** in the Actions menu (the mockup has four items; the issue asks for forcing a status).
  - The dialogs' titles, buttons and short lines (Reassign tradie, Refund, Edit price, Force status, Cancel this
    job?, Message both) and "This is a record only. No real money moves until real payments are on."
  - Greyed-out reasons: "No tradie yet", "Nothing to refund", "Locked once paid", "Already closed", "Not at this stage".
  - Money shows "Customer paid $372.00" without the card ("Visa ••42"): we don't store card details.
  - Payroll words: "After sign-off", "Queued", "Sent to payroll", "Paid", "No payout".
  - The timeline's dots follow the legend in the design note (customer, tradie, office, system); the mockup's own
    dots don't follow one rule.
