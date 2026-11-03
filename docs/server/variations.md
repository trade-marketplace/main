# Extra work

Issue #158 implements server commands and actions; it adds no screens. Stripe stays in test mode under the
existing key lock. The earlier prototype's request/pricing flow is reference only: its test payment shortcut
and pending-payment deletion are replaced by the shared checkout and verified webhook.

1. The current assigned worker (the lead) calls `beginVariationPhotoUploadAction(jobId, requestKey, size)`
   with a UUID request key and declared size, then uploads JPG/PNG/HEIC bytes directly to the returned signed
   Storage URL. Call `finishVariationPhotoUploadAction(stageId)` to validate actual bytes, strip metadata and
   obtain a processed private WebP path. These actions exchange only small JSON, preserving the shared 10 MB
   allowance without raising Next’s body limit or passing originals through Vercel. Invalid/failed finalization
   consumes the grant; obtain a new grant to try again. Completed grants replay the same processed path.
2. `requestVariationAction({ jobId, requestKey, description, hours, photoPaths })` requires an in-progress
   (`ASSIGNED`) job and 1–6 ready uploads belonging to that worker, job and request. Hours must resolve to whole
   minutes, up to 100 hours. Keep the UUID while retrying the same request; use a new UUID for another request.
3. The office calls `priceVariationAction(id, revision, minutes?, materialsCents?)`. It uses the job's frozen pricing, with no
   second minimum. Office materials are whole cents at cost, ex GST; frozen margin/GST apply, and materials
   never inflate worker labour pay. Omitted values retain the current quote on reprice. `loadVariationAction` supplies the current revision and only the requesting role's figures.
4. The job's customer calls `approveVariationAction(id, revision)` and follows the returned `/pay/<paymentId>`
   `href`. The action calls `startPayment`; it does not mark extra work approved. The existing signed webhook
   records payment and changes `PRICED` to `APPROVED` atomically, then notifies the worker. Alternatively,
   `declineVariationAction(id, revision)` marks it declined and notifies the worker.

Commands recheck profile roles and job ownership inside their transactions. The job row lock serializes requests,
pricing, decisions, checkout preparation and settlement against reassignment/status changes. Quote revisions
prevent a stale tab accepting a different price. Repricing is allowed while `PRICED`; any existing intent must be
confirmed cancelled first. Processing, succeeded or ambiguous cancellation leaves the quote intact for settlement
or retry. No answer leaves it `PRICED`; reminders are outside this issue.

Money that arrives after a job closes stays in the ledger and raises an office-only `payment.review_required`
notification; it never tells the worker to continue or enters approved-variation payout minutes. Only verified
paid approvals count in the existing `queuePayoutForJob` calculation.

All transitions write audit entries and launch in-app notifications in the same transaction. Notification or
audit failure rolls back the command, allowing an idempotent retry. Required evidence is server-only: short-lived
signed links are issued only to the current customer/worker/office. Upload records commit before Storage puts;
unattached photos older than 24 hours are removed in batches of at most 10. Cleanup shares the upload/attachment
lock, commits a deletion tombstone before removing Storage objects, and retains failed deletes for retry.
Random object keys are never reused. Detached photos remain recorded after variation/job deletion.
Raw staging grants bind owner, job and request, require the existing upload rate limit, and cap unfinished grants
at ten per worker. Originals cannot be read or attached from the browser. Both finalized and abandoned grants
remain tracked until their two-hour signed token expires plus five minutes, so a late token reuse is cleaned again.

The existing checkout uses “Extra work” and “Approve & pay” for variation payments. Its completion route reads
the owned payment kind and the actual approved variation revision/amount. Stripe success before webhook
settlement shows a bounded approval check; a recorded payment without approval shows office review, never a
booking or a go-ahead. Only a verified paid approval tells the customer their tradie was notified to proceed.

Schema, pricing, payments and authorization need William's review. Matt should review the exact extra-work
completion/checking copy listed in the PR and the guarded `/dev/components/pay?state=variation*` previews.
