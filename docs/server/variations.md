# Extra work

Issue #158 implements server commands and actions; it adds no screens. Stripe stays in test mode under the
existing key lock. The earlier prototype's request/pricing flow is reference only: its test payment shortcut
and pending-payment deletion are replaced by the shared checkout and verified webhook.

1. The current assigned worker (the lead) uploads JPG/PNG/HEIC evidence with `uploadVariationPhotoAction`,
   using a UUID `requestKey`. The shared upload service checks actual bytes and stores a processed WebP privately.
2. `requestVariationAction({ jobId, requestKey, description, hours, photoPaths })` requires an in-progress
   (`ASSIGNED`) job and 1–6 ready uploads belonging to that worker, job and request. Hours must resolve to whole
   minutes, up to 100 hours. Keep the UUID while retrying the same request; use a new UUID for another request.
3. The office calls `priceVariationAction(id, revision, minutes?)`. It uses the job's frozen pricing, with no
   second minimum. `loadVariationAction` supplies the current revision and only the requesting role's figures.
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

Schema, pricing, payments and authorization need William's review. The only new visible wording is the existing
inbox's office-only label “Payment needs review”; Matt should review it. There are no changed screen layouts.
