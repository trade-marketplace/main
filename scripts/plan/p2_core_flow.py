from base import E, F, T

E('post', 'Customer: post a job', 'customer', 'Customer home and the four-step post-a-job wizard, from describing the job to “Posted”.', 1)
E('cjob', 'Customer: price, pay & track a job', 'customer', 'The job page through every status: getting a price, price ready, decline, checkout, booked, cancel.', 1)
E('cafter', 'Customer: extra work, sign-off & history', 'customer', 'Approving extra work, checking the finished job, reviews, problems, my jobs, receipts and invoices.', 1)
E('tonb', 'Tradie: onboarding & verification', 'tradie', 'Setup checklist, trades and licences, bank and tax, work area, public profile, verified badge.', 1)
E('tfind', 'Tradie: finding work & estimating', 'tradie', 'Job board list, desktop and phone maps (Uber-style), availability and pings, blind estimates.', 1)
E('tdo', 'Tradie: claiming & doing the job', 'tradie', 'Claiming at the set price, booking a time window, preset updates, the job workspace, extra work, finishing, earnings.', 1)
E('pay', 'Payments & payouts', 'payments', 'Stripe (test mode) with Apple Pay, webhooks, refunds, GST invoices, materials budgets, payouts and the payroll export.', 1)
E('office', 'Office (admin)', 'office', 'Everything the TM office needs to run jobs: queues, pricing, sign-off checks, disputes, tradies, payouts, payments, settings.', 1)
E('shared', 'Shared: notifications, messages & support', 'shared', 'Bell and notifications page, problem threads (not open chat), in-app help and support.', 1)

# ---------------------------------------------------------------- CUSTOMER: POST
F('post-home', 'post', 'Customer home')
T('c-home', 'Customer home (signed in)', 1, pages=['C01'],
  ifs=['What if the customer has a job needing their action (price ready, extra work, sign-off)? That card comes first', 'What if they’re outside the coverage area (saved address)? Gentle banner with the waitlist'],
  deps=['ds-shell-app', 'ds-cards', 'visibility'])
F('post-wizard', 'post', 'Post-a-job wizard')
T('job-create', 'Server: create and save a job (draft → posted)', 1, labels=['needs-william'],
  what='Server actions behind the wizard: save a draft at each step, validate, check coverage, post the job (status REVIEW, job number, status history), tell eligible workers (notify), return the job id.',
  ac=['Validation with clear messages per field', 'Drafts saved per user (and in the browser for signed-out users) and restored', 'Posting is idempotent (double-click doesn’t create two jobs)'],
  ifs=['What if the customer isn’t signed in at the last step? Sign-up gate, then the draft posts', 'What if the address is outside coverage? Not posted; waitlist with their email', 'What if photos are still uploading? Post button waits'],
  notes='Old repo `tests/create-job.test.ts`.', deps=['status-machine', 'geo', 'uploads', 'notify'], ui=False)
T('post-1', 'Wizard step 1: describe the job', 1, pages=['C02'],
  ac=['Five categories: Electrical, Plumbing, Gas fitting, Construction, Other (anything); “Not sure” goes to Other', 'Customer copy never explains how pricing works'],
  ifs=['What if they pick Other? Description prompts “What do you need done?” with examples (moving, gardening, assembly…)', 'What if they leave and come back? Draft restored'],
  deps=['job-create', 'ds-forms', 'ds-cards'])
T('post-2', 'Wizard step 2: photos', 1, pages=['C03'],
  ifs=['What if they have no photos? Allowed with a nudge (“Photos get you a price faster”); job flagged for office', 'What if a photo is too big or the wrong type? Inline error on that photo only'],
  deps=['job-create', 'ds-media'])
T('post-3', 'Wizard step 3: where and when (time windows)', 1, pages=['C04'],
  ifs=['What if they choose ASAP? Job marked urgent and raised in worker pings', 'What if every window is in the past by the time it’s claimed? Customer asked to add new windows', 'What if the address is a business or unit? Unit/flat field and access notes'],
  deps=['job-create', 'geo', 'ds-forms'])
T('post-4', 'Wizard step 4: check and post (+ sign-up gate)', 1, pages=['C05'],
  ifs=['What if posting fails? Error with retry; nothing lost'], deps=['post-1', 'post-2', 'post-3', 'signup-customer'])
T('posted', 'Posted (success)', 1, pages=['C06'], deps=['post-4'])

# ---------------------------------------------------------------- CUSTOMER: JOB PAGE
F('cjob-page', 'cjob', 'Job page by status')
T('job-page', 'Customer job page frame (status-driven)', 1,
  what='The single customer job page `/jobs/[id]` that shows the right panel for the job’s status, with the tracker, photos, details, time windows and help. Each status panel is its own task.',
  ac=['Status → panel mapping in one place', 'Tracker (M11) and status pill labels from `job_statuses`', 'Live-ish: refreshes when the status changes (poll or revalidate)'],
  ifs=['What if the job belongs to someone else? 404', 'What if the job was cancelled? Read-only page with what happened'],
  mock='w-c-waiting', deps=['visibility', 'ds-status', 'ds-shell-app'], ui=True)
T('c-waiting', 'Job · getting your price', 1, pages=['C07'],
  ifs=['What if it takes more than 24h? Banner: “Taking a little longer than usual” + what happens next', 'What if the customer wants to edit details? Allowed until priced; workers who estimated are told it changed'],
  deps=['job-page'])
T('windows-edit', 'Change time windows from the job page', 1, size='S',
  what='Customers can add or remove time windows from the job page until a worker books one.', mock='w-c-post3',
  ifs=['What if a worker is booking at the same moment? Booking wins; customer sees “Booked for …”'], deps=['job-page'], ui=True)
T('c-price', 'Job · price ready', 1, pages=['C08'],
  ifs=['What if the price changes (office re-prices)? Customer notified; old price shown struck through', 'What if they don’t respond for 7 days? Reminder, then the job expires and they can re-post'],
  deps=['job-page', 'pricing', 'scheduler'])
T('c-decline', 'Decline price dialog', 1, pages=['C09'],
  ifs=['What if they decline? Free, job closed; reason recorded for the office (too expensive / changed my mind / found someone)'], deps=['c-price', 'ds-overlays'])
T('c-booked', 'Job · booked / worker confirmed', 1, pages=['C12'],
  ac=['Shows the booked window and preset updates (on my way, running late, reschedule) as they happen', 'Worker’s first name, photo, verified badge, rating; phone visible once claimed'],
  ifs=['What if nobody claims within 48h? Office alerted; customer sees “We’re finding someone” (never a scary message)', 'What if the worker reschedules? Customer picks from new windows or keeps the old one'],
  deps=['job-page'])
T('c-cancel', 'Cancel job dialog', 1, pages=['C17'],
  ifs=['What if they haven’t paid? Cancel instantly, free', 'What if they’ve paid? → “Cancel requested” (CANCEL_REVIEW); office investigates before any refund; worker sees “On hold”', 'What if the worker is on the way? Warn the customer that a call-out may apply'],
  deps=['job-page', 'status-machine', 'ds-overlays'])

F('cjob-pay', 'cjob', 'Checkout')
T('c-checkout', 'Checkout page', 1, pages=['C10'],
  ifs=['What if the card is declined? Stay on the page with the reason and try again', 'What if 3-D Secure is needed? Handled inline', 'What if they pay twice (double click / two tabs)? Second attempt blocked'],
  deps=['stripe-intent', 'c-price'])
T('c-paid', 'Payment success', 1, pages=['C11'], deps=['c-checkout', 'stripe-webhooks'])

# ---------------------------------------------------------------- CUSTOMER: AFTER
F('cafter-work', 'cafter', 'During and after the job')
T('c-extra', 'Extra work approval (and pay)', 1, pages=['C13'],
  ifs=['What if the customer declines the extra work? Worker finishes the original job only; office notified', 'What if they don’t respond within 24h? Reminder; worker sees “Waiting on approval”'],
  deps=['job-page', 'variations', 'stripe-intent'])
T('c-signoff', 'Job · please check (sign-off)', 1, pages=['C14'],
  ifs=['What if the customer does nothing for 48h? Auto-completes; customer told', 'What if they’re not happy? “Report a problem” instead of sign-off; payout held'],
  deps=['job-page', 'scheduler'])
T('c-review', 'Leave a review', 1, pages=['C15'],
  ifs=['What if they want to change it? Editable for 7 days', 'What if the review is abusive? Office can hide it (F12)'], deps=['c-signoff'])
T('c-problem', 'Report a problem', 1, pages=['C16'],
  ifs=['What if the problem is urgent/safety (exposed wires, leak)? Clear “call 111 if dangerous” + urgent flag to office'], deps=['job-page', 'problem-threads'])
F('cafter-hist', 'cafter', 'My jobs and receipts')
T('c-myjobs', 'My jobs', 1, pages=['C18'], deps=['ds-shell-app', 'visibility', 'ds-data'])
T('c-receipts', 'Payments and receipts', 1, pages=['C19'], deps=['ds-shell-app', 'stripe-webhooks'])
T('c-invoice', 'Tax invoice / receipt page', 1, pages=['C20'],
  ac=['Valid NZ tax invoice: “Tax invoice”, TM name and GST number, date, invoice number, description, GST amount, total incl GST', 'Print stylesheet (G09) and PDF download'],
  ifs=['What if there were extra work or a quick look credit? Each is a line'], deps=['gst-invoices'])
T('c-addresses', 'Saved addresses', 3, prio='P2', pages=['C21'], deps=['geo', 'ds-shell-app'])

# ---------------------------------------------------------------- TRADIE: ONBOARDING
F('tonb-setup', 'tonb', 'Getting set up')
T('t-onboard', 'Tradie home: setup checklist', 1, pages=['D01'],
  ifs=['What if they’re waiting on licence checks? They can browse and estimate but not claim restricted work', 'What if they only do Other work? Checklist has no licence step'],
  deps=['ds-shell-app', 'signup-tradie'])
T('t-licences', 'Trades and licences', 1, pages=['D14'],
  ac=['Restricted trades (electrical, plumbing, gas, drainlaying, restricted building) need a licence on file and an office check before claiming', 'Other needs no licence'],
  ifs=['What if a licence is rejected? Reason shown + how to fix', 'What if a licence expires? Reminder 30 days before; claiming that trade blocked after expiry'],
  deps=['schema-users', 'uploads', 'dec-licence-check'])
T('t-payroll', 'Bank and tax details', 1, pages=['D15'], labels=['needs-william'],
  ac=['IRD number and bank account validated (checksum) and stored encrypted', 'Tax code choice with a plain explanation link'],
  ifs=['What if details are missing at payout time? Payout waits; worker gets a nudge'], deps=['schema-users'])
T('t-area', 'Work area and job alerts', 1, pages=['D16'], deps=['geo', 'notify'])
T('t-public-edit', 'Public profile editor', 3, prio='P2', pages=['D17'], deps=['uploads'])
T('verified-badge', 'Verified badge rules', 1, size='S', labels=['needs-william'],
  what='Compute the verified badge: email + phone confirmed, ID/identity check done by office, and (for restricted trades) a verified licence. Shown on tiles, profiles and the customer’s booked panel.',
  ifs=['What if a worker is paused by the office? Badge and claiming removed immediately'], deps=['t-licences'], ui=False)
T('eligibility', 'Who can see and claim which jobs', 1, size='S', labels=['needs-william', 'port-from-old-repo'],
  what='Rules: Other jobs → anyone verified-basic; restricted categories → a verified licence for that trade; inside the worker’s work area; not paused. Used by the board, map, pings and claim.',
  ifs=['What if a worker is also the customer (posted their own job)? They can’t estimate or claim it'],
  notes='Old repo `trade-readiness.ts`, `tests/discovery-trades.test.ts`.', deps=['verified-badge', 'geo'], ui=False)

# ---------------------------------------------------------------- TRADIE: FIND WORK
F('tfind-board', 'tfind', 'Job board and maps')
T('t-board', 'Job board · list', 1, pages=['D02'],
  ac=['Filters: kind (ready to claim / needs estimate / quote bounty), category, distance; sort nearest / newest / earn', 'Only jobs the worker is eligible for'],
  ifs=['What if there’s nothing nearby? Empty state suggests widening the area and turning on alerts'], deps=['eligibility', 'ds-cards', 'ds-shell-app'])
T('mapbox', 'Map provider wiring (Mapbox)', 1, size='S',
  what='Mapbox map component with our pin components, clustering, fit-to-bounds, current location (with permission), and a token that is URL-restricted.',
  ifs=['What if location permission is denied? Centre on the work area instead', 'What if the map fails to load? Fall back to the list view'], deps=['ds-map'], ui=True)
T('t-map-desk', 'Job board · map (desktop)', 1, pages=['D03'], deps=['mapbox', 't-board'])
T('t-map-phone', 'Job map on the phone (Uber-style) + available switch', 1, pages=['D18'],
  ifs=['What if the worker switches “available” off? No pings; map still works'], deps=['mapbox', 't-board'])
T('t-ping', 'New job pings for available workers', 3, prio='P2', pages=['D20'],
  ifs=['What if lots of jobs arrive at once? Batch into one ping', 'What if it’s late at night? Respect quiet hours unless ASAP'], deps=['t-map-phone', 'notify'])
F('tfind-est', 'tfind', 'Blind estimates')
T('t-estimate', 'Job · needs estimate', 1, pages=['D04'],
  ifs=['What if they already estimated? Show theirs with “Edit” until the job is priced', 'What if they aren’t eligible for this trade? Explain why'], deps=['eligibility', 'visibility'])
T('t-estimate-drawer', 'Estimate drawer (blind)', 1, pages=['D05'], labels=['needs-william'],
  ac=['Hours + materials + note; never shows anyone else’s estimate or any average'],
  ifs=['What if hours are silly (0 or 200)? Sensible limits with a message', 'What if the job was edited after they estimated? Banner asks them to check their estimate'],
  deps=['t-estimate', 'ds-overlays'])
T('t-est-history', 'Estimates history', 3, prio='P2', pages=['D13'], deps=['t-estimate-drawer'])

# ---------------------------------------------------------------- TRADIE: DO THE JOB
F('tdo-claim', 'tdo', 'Claiming and booking')
T('t-claim', 'Job · ready to claim', 1, pages=['D06'], ac=['Shows exactly what the worker earns, never the customer price'], deps=['eligibility', 'visibility', 'pricing'])
T('t-claim-confirm', 'Claim confirm and result (race-safe)', 1, pages=['D07'], labels=['needs-william'],
  ifs=['What if two workers claim at the same moment? Only one wins; the other sees M22 “Too slow” with no shaking', 'What if the worker loses eligibility mid-claim (paused, licence expired)? Claim refused with the reason'],
  deps=['t-claim', 'status-machine'])
T('t-book', 'Book a time window', 1, pages=['D27'],
  ifs=['What if none of the customer’s windows work? “Suggest other times” sends the customer a request to add windows', 'What if the worker needs to reschedule later? Pick a new window; customer approves or picks another'],
  deps=['t-claim-confirm'])
T('t-release', 'Can’t make it: release a claimed job', 1, size='S',
  what='A worker can hand a claimed job back (with a reason). It returns to “ready to claim”, the customer is told kindly, office is alerted if it happens close to the booked window.',
  ifs=['What if they release within 24h of the window or repeatedly? Flagged to office; may pause claiming'], deps=['t-claim-confirm'], mock='w-t-workspace', ui=True)
F('tdo-work', 'tdo', 'Doing the job')
T('t-mywork', 'My work', 1, pages=['D08'], deps=['ds-shell-app', 'visibility'])
T('t-workspace', 'Job workspace + preset updates', 1, pages=['D09'],
  ac=['Preset updates instead of chat: “On my way”, “Running late (15/30/60 min)”, “Need to reschedule”; each notifies the customer', 'Exact address, map link and customer phone (claimed only)', 'Materials budget and job number (TM-####) for the supplier account'],
  ifs=['What if the customer isn’t home? “Customer not home” preset + office alerted'], deps=['t-claim-confirm', 'notify'])
T('t-extra', 'Request extra work', 1, pages=['D10'],
  ifs=['What if the customer declines? Worker told; finish the original scope'], deps=['t-workspace', 'variations'])
T('t-finish', 'Finish job (evidence, CoC, materials)', 1, pages=['D11'], labels=['needs-william'],
  ac=['Electrical: CoC number + PDF/photo required', 'Other trades: after photos + notes required', 'Declaration tick box', 'Materials spent entered; over budget needs a reason'],
  ifs=['What if the upload fails? Retry; nothing submitted until all files are in', 'What if materials went over budget? Flag to office before payout'],
  deps=['t-workspace', 'uploads', 'dec-materials'])
T('t-earnings', 'Earnings', 1, pages=['D12'], deps=['payouts', 'ds-shell-app'])

# ---------------------------------------------------------------- PAYMENTS
F('pay-stripe', 'pay', 'Taking payments (Stripe, test mode)')
T('stripe-setup', 'Stripe setup in test mode', 1, size='S', labels=['needs-william', 'human-only'],
  what='Create the Stripe account (test mode), keys in env, Payment Element with cards, Apple Pay and Google Pay. Test-mode banner shows whenever keys are test keys.',
  ac=['Live keys cannot be used unless `PAYMENTS_LIVE=1` (set only when both founders agree)'], deps=['scaffold'], owner='william')
T('stripe-intent', 'Create and confirm payments', 1, labels=['needs-william', 'port-from-old-repo'],
  what='Server creates a PaymentIntent for the job price (or extra work, or the $30 quick look) with an idempotency key; client confirms with the Payment Element.',
  ifs=['What if the price changed since the page loaded? Refuse and reload with the new price', 'What if the job was cancelled meanwhile? Refuse'],
  notes='Old repo `record-test-payment.ts`, `payment-eligibility.ts`.', deps=['stripe-setup', 'status-machine'], ui=False)
T('stripe-webhooks', 'Stripe webhooks', 1, size='S', labels=['needs-william'],
  what='Verify signatures; on success mark the payment PAID and move the job (PRICED → BOOKABLE, extra work → APPROVED); on failure/refund update records; idempotent.',
  ifs=['What if the webhook arrives twice or out of order? Idempotent by event id', 'What if it never arrives? Checkout success page polls; scheduler reconciles'], deps=['stripe-intent'], ui=False)
T('apple-pay', 'Apple Pay domain verification', 3, size='S', labels=['human-only'], what='Register the production domain with Stripe for Apple Pay.', deps=['dec-domain', 'stripe-setup'], owner='william', ui=False)
T('refunds', 'Refunds', 1, size='S', labels=['needs-william'], what='Office can refund all or part of a payment with a reason (audit logged). Customer notified.',
  ifs=['What if the payout was already made? Refund still possible; flagged for payroll adjustment'], deps=['stripe-webhooks', 'audit'], ui=False)
F('pay-money', 'pay', 'Invoices, materials and payouts')
T('variations', 'Extra work (variations) server logic', 1, labels=['needs-william', 'port-from-old-repo'],
  what='Worker requests (photos + hours estimate) → office prices → customer approves and pays → worker continues. Uses the pricing engine.', deps=['pricing', 'status-machine'], ui=False)
T('gst-invoices', 'GST tax invoices and numbering', 1, size='S', labels=['needs-william'], what='Sequential invoice numbers, invoice data per payment, credit notes for refunds.', deps=['stripe-webhooks'], ui=False)
T('materials', 'Materials budgets and job numbers', 1, size='S', labels=['needs-william', 'port-from-old-repo'],
  what='Each job has a materials budget (ex GST) and a TM-#### job number for supplier accounts; actual spend recorded at finish; over-budget flagged.', deps=['schema-money', 'dec-materials'], ui=False)
T('payouts', 'Payout calculation', 1, size='S', labels=['needs-william', 'port-from-old-repo'],
  what='On completion, queue a payout: hours × frozen rate, 8% holiday pay, status QUEUED. Bank/tax details required.', deps=['pricing', 'status-machine'], ui=False)
T('payroll-export', 'Payroll export', 1, size='S', labels=['needs-william', 'port-from-old-repo'],
  what='Export queued payouts in the payroll provider’s format; mark as EXPORTED; mark PAID when confirmed.', deps=['payouts', 'dec-payroll'], ui=False)

# ---------------------------------------------------------------- OFFICE
F('office-run', 'office', 'Running jobs')
T('o-queues', 'Queues (office home)', 1, pages=['F01'], deps=['ds-shell-office', 'visibility'])
T('o-price', 'Price a job', 1, pages=['F02'], labels=['needs-william'],
  ac=['Sees every estimate, the spread and the pricing engine preview (customer price, worker earn, margin)', 'Can send the price, ask for more photos, or send to a quick look (from milestone 2)'],
  ifs=['What if estimates disagree a lot? Highlighted; suggest a quick look', 'What if there are no estimates after 24h? Office can price from photos'], deps=['o-queues', 'pricing'])
T('o-variation', 'Price extra work', 1, pages=['F03'], deps=['o-queues', 'variations'])
T('o-jobs', 'All jobs', 1, pages=['F04'], deps=['ds-shell-office', 'ds-data'])
T('o-job', 'Job admin view', 1, pages=['F05'], labels=['needs-william'],
  ac=['Full timeline (status history + audit log)', 'Actions: re-price, reassign, force status (with reason), cancel, refund'],
  deps=['o-jobs', 'audit'])
T('o-disputes', 'Cancellations and disputes', 1, pages=['F06'], ifs=['What if the worker already did part of the work? Partial refund + part payout'], deps=['o-job', 'refunds'])
T('o-signoff', 'Sign-off and CoC review', 1, pages=['F07'], ifs=['What if the CoC number looks wrong? Send back to the worker with a note; payout held'], deps=['o-job', 't-finish'])
F('office-people', 'office', 'People, money and settings')
T('o-tradies', 'Tradies (verify, pause)', 1, pages=['F08'], labels=['needs-william'], deps=['ds-shell-office', 't-licences'])
T('o-customers', 'Customers', 3, prio='P2', pages=['F09'], deps=['ds-shell-office'])
T('o-payouts', 'Payouts', 1, pages=['F10'], deps=['payroll-export'])
T('o-payments', 'Payments and refunds', 1, pages=['F11'], deps=['refunds'])
T('o-reviews', 'Reviews moderation', 3, prio='P2', pages=['F12'], deps=['c-review'])
T('o-support', 'Support inbox', 1, pages=['F13'], deps=['problem-threads'])
T('o-settings', 'Settings', 1, pages=['F14'], labels=['needs-william'],
  ac=['Rates (shared + Other), on-costs, margin, GST, minimum hours, auto-release hours, quick-look price, bounty expiry, coverage area', 'Every change audit-logged; never changes already-priced jobs'],
  deps=['ds-shell-office', 'audit'])
T('o-admins', 'Office users', 1, size='S', labels=['needs-william', 'port-from-old-repo'], what='Make or remove office (ADMIN) users safely (script or settings page).', notes='Old repo `scripts/make-admin.ts`.', deps=['sessions'], ui=False)

# ---------------------------------------------------------------- SHARED
F('shared-notif', 'shared', 'Notifications and help')
T('notif-dropdown', 'Notifications dropdown (bell)', 1, pages=['E02'], deps=['notify', 'ds-shell-app'])
T('notif-page', 'Notifications page', 1, pages=['E03'], deps=['notif-dropdown'])
T('problem-threads', 'Problem threads (instead of open chat)', 1, labels=['needs-william'],
  what='Decision: avoid direct messages. A thread opens only for a problem or support request on a job (customer, assigned worker and office). Preset updates cover normal communication.', pages=['E01'],
  ifs=['What if someone shares a phone number or email to go direct? Allowed after claim (numbers are visible then); before claim, hidden'],
  deps=['schema-after', 'notify'])
T('help-in-app', 'Help in the app + support thread', 1, pages=['E08'], deps=['problem-threads', 'help-centre'])
T('search', 'Global search', 3, prio='P2', pages=['E09'], deps=['ds-shell-app'])
