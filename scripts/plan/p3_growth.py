from base import E, F, T, I, PAGES

E('bounty', 'Quote bounties & AI pricing', 'bounties', 'When the Trade Marketplace AI can’t price a job, the customer books a $30 quick look and a gold quote bounty appears on the map for 24h. Quotes are checked for fairness; fair, accepted quoters get first dibs.', 2)
E('pub', 'Public website', 'public-site', 'Landing, how it works, for tradies, service pages, trust, waitlist, about, contact, help centre, public profiles and legal pages.', 3)
E('sys', 'System pages, emails & polish', 'system', 'Error pages, offline, transactional emails, SMS/push copy, icons and share images, install as app, print styles.', 3)
E('launch', 'Launch readiness (Invercargill)', 'launch', 'Everything between “it works” and real customers: production setup, security, privacy, accessibility, legal, business setup, pilot and going live.', 3)
E('crew', 'Crews (team jobs)', 'crews', 'One lead per job sets each person’s split and invites crew, who accept or decline. The customer only sees the lead.', 4)
E('quoter', 'Verified quoters', 'quoters', 'An invite-only role for experienced people who earn by quoting in person: $30 per quote + 2% when accepted, fair and no dispute + a weekly accuracy bonus.', 5)
E('ideas', 'Ideas for later', 'shared', 'Captured so they aren’t lost. A founder turns one into tasks when it’s time.')

# ---------------------------------------------------------------- BOUNTIES
F('bounty-ai', 'bounty', 'AI pricing')
T('ai-v0', 'AI pricing v0 (rules-based)', 2, labels=['needs-william'],
  what='A pricing check that looks at a job’s estimates (how many, how spread out), the category and the standard-job menu, and returns: a price it’s confident in, “needs a quick look”, or “office review”. Thresholds come from settings.',
  why='Takes the founder out of pricing every job (the business plan’s biggest bottleneck).',
  ac=['Pure function with thresholds as inputs; every outcome explained in plain words for the office', 'Never sends a price to a customer without passing the thresholds', 'Office can always override'],
  ifs=['What if there are too few estimates after 24h? Office review', 'What if the category is Other and nothing matches the menu? Quick look', 'What if one estimate is wildly off? Trimmed (drop highest and lowest) as in the business plan'],
  tests=['Table-driven tests for each threshold edge'], deps=['pricing', 'dec-ai-fair'], ui=False)
T('job-menu', 'Standard job menu (fixed prices)', 2, prio='P2', labels=['needs-william'],
  what='Office-managed list of common jobs with set hours/materials (e.g. “replace a power point”, “install a downlight”, “assemble flat-pack furniture”). The AI uses it; matching jobs can be priced instantly.',
  ifs=['What if a job partly matches? Suggest, office confirms'], deps=['o-settings'], ui=True, mock='w-o-settings')
T('o-ai', 'Office: AI pricing review', 2, prio='P2', pages=['F15'], deps=['ai-v0', 'ds-shell-office'])
F('bounty-flow', 'bounty', 'Quick look and bounty flow')
T('schema-bounty', 'Schema 5: quote bounties', 2, size='S', labels=['needs-william'],
  what='Bounty per job: amount ($30 from settings), created/expires at (24h), claimed by, booked window, submitted quote (fixed price, hours, materials, notes, photos), fairness result, first-dibs window. Adds settings: first-dibs hours, fairness tolerance.', deps=['schema-after'], ui=False)
T('c-quicklook', 'Customer: needs a $30 quick look', 2, prio='P2', pages=['C22'],
  ac=['Customer picks windows and pays $30; told it comes off the final price if they go ahead', 'Customer copy never explains AI, estimates or bounties'],
  ifs=['What if the customer says no to the $30? Follow **Decide: bounty expiry / quick-look decline**'],
  deps=['schema-bounty', 'stripe-intent', 'dec-bounty-edge'])
T('bounty-create', 'Create the gold bounty when the quick look is paid', 2, size='S', labels=['needs-william'],
  what='Payment success → job QUOTE_BOUNTY → bounty with 24h expiry → shown gold on boards and maps → pings to available workers nearby.', deps=['c-quicklook', 'status-machine', 'stripe-webhooks'], ui=False)
T('bounty-board', 'Bounties on the job board and maps (gold)', 2, size='S',
  what='Gold bounty pins with countdown and the M27 shimmer on the desktop map, phone map and list; “Bounty” filter chip; legend.', mock='w-t-map', motion=['M27', 'M21'],
  deps=['bounty-create', 't-map-desk', 't-map-phone'], ui=True)
T('t-bounty', 'Quote bounty page + claim (phone first)', 2, prio='P2', pages=['D19'],
  ifs=['What if two people claim at once? One wins (same rule as job claims)', 'What if the claimer doesn’t visit in their window? Bounty re-opens; strike recorded', 'What if it expires while they’re viewing? Page updates to “Expired”'],
  deps=['bounty-board'])
T('bounty-quote', 'Submit the in-person quote', 2, labels=['needs-william'],
  what='After the visit the quoter sends a fixed price (hours + materials + notes + photos). The AI fairness check runs. Fair → becomes the customer’s price (minus the $30 already paid). Unfair → ignored and the job opens to anyone.',
  ifs=['What if the quote is way off (e.g. $1,200 on a $300 job)? Ignored, quoter told kindly, job opens to all', 'What if the customer declines a fair quote? Quoter keeps the $30; no first dibs'],
  deps=['t-bounty', 'ai-v0'], ui=True, mock='m-bounty')
T('first-dibs', 'First dibs for fair, accepted quotes', 2, size='S', labels=['needs-william'],
  what='If the customer accepts and the quote was fair, the quoter gets an exclusive window (e.g. 4h, in settings) to claim the job before it opens to everyone.',
  ifs=['What if they don’t claim in time? Opens to all'], deps=['bounty-quote'], ui=False)
T('quicklook-credit', '$30 comes off the final price', 2, size='S', labels=['needs-william'], what='Pricing and invoices show the quick-look payment as a credit line; the customer pays the rest.', deps=['bounty-quote', 'gst-invoices'], ui=False)
T('bounty-expiry', 'Bounty expiry after 24h', 2, size='S', labels=['needs-william'], what='Scheduler expires unclaimed bounties and follows the founders’ rule.', deps=['bounty-create', 'scheduler', 'dec-bounty-edge'], ui=False)
T('bounty-pay', 'Pay the quoter their $30', 2, size='S', labels=['needs-william'], what='A payout line for each completed quote visit.', deps=['bounty-quote', 'payouts'], ui=False)

# ---------------------------------------------------------------- CREWS
F('crew-core', 'crew', 'Team jobs')
T('schema-crew', 'Schema 6: crew members and splits', 4, size='S', labels=['needs-william'], what='Job members (lead + crew), share % or $, invite status (invited/joined/declined/expired), saved crew list per worker.', deps=['schema-after'], ui=False)
T('t-crew-add', 'Lead adds a crew (sets the split)', 4, prio='P2', pages=['D21'],
  ac=['Shares must add up to 100% (lead’s share shown)', 'Each crew member doing restricted work needs that licence'],
  ifs=['What if a crew member declines? Lead re-assigns their share or invites someone else', 'What if the split changes after work starts? Everyone must accept the change'],
  deps=['schema-crew', 't-workspace'])
T('t-crew-invite', 'Crew invite: accept or decline', 4, prio='P2', pages=['D22'], ifs=['What if they don’t answer in 24h? Invite expires; lead told'], deps=['t-crew-add', 'notify'])
T('t-crew-list', 'My crew', 4, prio='P2', pages=['D23'], deps=['schema-crew'])
T('crew-visibility', 'Customer only ever sees the lead', 4, size='S', labels=['needs-william'], what='Update the who-sees-what rules: customers see the lead only; crew see job details but not the customer price.', deps=['visibility', 'schema-crew'], ui=False)
T('crew-payouts', 'Split payouts for crews', 4, size='S', labels=['needs-william'],
  what='On completion, one payout per member by their share, each with holiday pay, through payroll.', ifs=['What if the lead drops out mid-job? Office reassigns lead; shares re-agreed'], deps=['payouts', 'schema-crew'], ui=False)

# ---------------------------------------------------------------- QUOTERS
F('quoter-core', 'quoter', 'Verified quoter role')
T('quoter-role', 'Quoter role and invites', 5, prio='P3', size='S', labels=['needs-william'], what='A quoter flag on a worker; only the office can invite. Quoters see all bounties regardless of trade (they quote, they don’t do the work).', deps=['schema-bounty'], ui=False)
T('quoter-apply', 'Become a verified quoter (apply/screening)', 5, prio='P3', pages=['D26'], deps=['quoter-role'])
T('quoter-dash', 'Verified quoter dashboard', 5, prio='P3', pages=['D25'], deps=['quoter-earn'])
T('quoter-earn', 'Quoter earnings: 2% and weekly accuracy bonus', 5, prio='P3', labels=['needs-william'],
  what='2% (of the basis decided) when the quote is accepted, deemed fair and the job finishes with no dispute; weekly bonus for quotes that land near the final price.',
  ifs=['What if a dispute opens after payment? 2% held until resolved'], deps=['quoter-role', 'dec-2pct', 'bounty-pay'], ui=False)
T('o-quoters', 'Office: verified quoters', 5, prio='P3', pages=['F16'], deps=['quoter-role', 'ds-shell-office'])

# ---------------------------------------------------------------- PUBLIC SITE
F('pub-pages', 'pub', 'Marketing pages')
for code, key, prio in [('A01', 'p-landing', 'P1'), ('A02', 'p-how', 'P1'), ('A03', 'p-fortradies', 'P1'), ('A06', 'p-trust', 'P1'), ('A08', 'p-about', 'P2')]:
    T(key, PAGES[code]['name'], 3, prio=prio, pages=[code], deps=['ds-shell-site'], labels=['needs-matt'],
      ac=['Copy follows the voice rules; customer copy never explains how pricing works', 'Says “any job” (not just sparkies) and Invercargill'])
T('p-services', 'Service pages per trade', 3, prio='P2', pages=['A04'], deps=['ds-shell-site'], labels=['needs-matt'])
T('p-locations', 'Location pages per city', 3, prio='P3', pages=['A05'], deps=['p-services'])
T('p-waitlist', 'Not in your area yet (waitlist)', 1, pages=['A07'], ifs=['What if they’re already on the list? Friendly “You’re on it”'], deps=['ds-shell-site', 'geo'])
T('p-contact', 'Contact page + form', 3, pages=['A09'], ifs=['What if it’s spam? Honeypot + rate limit'], deps=['ds-shell-site', 'notify'])
T('help-centre', 'Help centre (home, search, articles)', 1, pages=['A10', 'A11'], labels=['needs-matt'],
  what='Help articles written in Markdown in the repo, with search and “Was this helpful?”.', deps=['ds-shell-site'])
T('p-profile', 'Public tradie profile', 3, prio='P2', pages=['A12'], deps=['ds-shell-site', 'verified-badge'])
F('pub-legal', 'pub', 'Legal')
T('p-legal', 'Legal pages (terms, worker terms, privacy)', 3, pages=['A13', 'A14', 'A15'], labels=['needs-matt'], what='Page template for legal text with last-updated date and PDF. Wording comes from the lawyer.', deps=['ds-shell-site', 'dec-legal'])
T('p-cookies', 'Cookie notice and banner', 3, pages=['A16'], deps=['p-legal', 'dec-analytics'])
T('seo', 'SEO basics', 3, size='S', what='Page titles and descriptions, sitemap.xml, robots.txt, canonical URLs, structured data for the business, and no indexing of app pages.', deps=['p-landing'], ui=False)

# ---------------------------------------------------------------- SYSTEM
F('sys-pages', 'sys', 'System pages and assets')
T('s-errors', '404 and 500 pages', 0, pages=['G01', 'G02'], deps=['ds-shell-site'])
T('s-maint', 'Maintenance page', 3, prio='P2', pages=['G03'], deps=['s-errors'])
T('s-offline', 'Offline banner', 1, pages=['G04'], ifs=['What if they submit a form offline? Keep it and offer to send when back online'], deps=['ds-feedback'])
T('s-emails', 'Transactional email templates', 1, pages=['G05'], labels=['needs-matt'], what='Templates for every event in the notification catalogue, light and dark mail clients.', deps=['notify-email'])
T('s-sms', 'SMS and push copy', 1, pages=['G06'], labels=['needs-matt'], deps=['notify-email'])
T('s-meta', 'Favicon, app icon and share images', 3, pages=['G07'], labels=['needs-matt'], deps=['ds-tokens'])
T('s-pwa', 'Install as app (PWA)', 3, prio='P2', pages=['G08'], ifs=['What if push isn’t supported (older iPhones)? Fall back to SMS/email'], deps=['s-meta'])
T('s-print', 'Print styles', 1, pages=['G09'], deps=['c-invoice'])

# ---------------------------------------------------------------- LAUNCH
F('launch-tech', 'launch', 'Production and quality')
T('prod', 'Production hosting, database backups and domain', 3, size='M', labels=['needs-william', 'human-only'],
  what='Production environment, daily database backups with a tested restore, environment secrets, domain + HTTPS, email DNS (SPF, DKIM, DMARC).', deps=['dec-hosting', 'dec-domain'], owner='william', ui=False)
T('monitoring', 'Monitoring and alerts', 3, size='S', labels=['needs-william'], what='Error tracking, uptime check, alerts to the founders for errors, failed payments and stuck jobs.', deps=['dec-monitoring', 'prod'], ui=False)
T('security', 'Security review', 3, labels=['needs-william'],
  what='Go through OWASP top 10: try opening every job/route as the wrong user (IDOR), check every server action’s role check, upload abuse, rate limits, secrets, headers (CSP, HSTS).', ifs=['What if a hole is found? Fix before launch, add a test'], deps=['visibility', 'ratelimit'], ui=False)
T('privacy', 'Privacy Act checklist', 3, size='S', labels=['needs-william'],
  what='NZ Privacy Act 2020: what we collect and why, retention periods, access/correction requests, breach plan, IRD/bank data handling, photo location stripping.', deps=['dec-legal'], ui=False)
T('a11y-audit', 'Accessibility audit', 3, size='S', what='Keyboard and screen-reader run-through of the full job flow for each role; fix or file issues.', deps=['c-signoff', 't-finish'], ui=True, mock='w-c-home')
T('perf', 'Performance check', 3, size='S', what='Lighthouse on landing, job board and job page on a mid-range phone; images optimised; budgets in CI.', deps=['p-landing', 't-board'], ui=False)
T('e2e-flow', 'End-to-end test of the whole job flow', 1, labels=['needs-william'],
  what='One Playwright test: customer posts → office prices → customer pays (test card) → worker claims and books → finishes → customer signs off → payout queued. Runs in CI.', deps=['c-signoff', 'o-price', 't-finish', 'payouts'], ui=False)
F('launch-biz', 'launch', 'Business setup (founders)')
for k, title, what in [
    ('biz-company', 'Company, GST and bank account', 'Register the company and GST, open the business bank account, connect it to Stripe.'),
    ('biz-insurance', 'Insurance', 'Public liability and professional indemnity cover.'),
    ('biz-accountant', 'Accountant: employment, GST and payroll set-up', 'Confirm casual-employee model, payroll, GST treatment of the $30 quick look and quoter payments.'),
    ('biz-suppliers', 'Supplier trade accounts', 'Telfer account (likely a personal guarantee) and accounts for other trades if decided.'),
    ('biz-workers', 'Sign up the first workers in Invercargill', 'Talk to ~10 tradies and general workers; onboard and verify the first ones.'),
    ('biz-help-content', 'Write the first help articles', 'FAQ for customers and workers (Matt).'),
]:
    T(k, title, 3, size='S', what=what, labels=['human-only'], owner='both', ui=False)
T('pilot', 'Pilot: 10–20 real jobs in Invercargill', 3, labels=['human-only'], what='Run real jobs with test payments or manual invoicing, collect feedback, check margins. Turn every finding into an issue.', deps=['e2e-flow', 'biz-workers'], owner='both', ui=False)
T('go-live', 'Switch real payments on', 3, labels=['human-only', 'needs-william'], what='Only when both founders agree in writing on this issue: live Stripe keys, `PAYMENTS_LIVE=1`, test-mode banner gone, one real $1 payment and refund to check.',
  deps=['pilot', 'security', 'privacy', 'p-legal', 'biz-company', 'apple-pay', 'monitoring'], owner='both', ui=False)

# ---------------------------------------------------------------- IDEAS
F('ideas-all', 'ideas', 'Ideas backlog')
I('idea-specialist', 'Request a specialist inside a job', 'A solo worker on a bigger job (e.g. a bathroom reno) can ask for a plumber or sparky to join without a new job being posted.', source='Matt, 23 Oct 2026; designed as D24 (P3).', pages=['D24'])
I('idea-recruit', 'Recruit workers into your team', 'Let workers build a standing team they can bring onto jobs and grow over time.', source='Matt, 23 Oct 2026.')
I('idea-per-trade-rates', 'Per-trade rates', 'Different rates per trade instead of one shared rate + Other.', source='DECISIONS.md #9.')
I('idea-credits', 'Estimate credits and first pick', 'Accurate estimates earn the right to take jobs (from the business plan).', source='BUSINESS_PLAN.md “Planned”.')
I('idea-anti-padding', 'Anti-padding watch', 'Flag workers who estimate high consistently; compare estimates with how jobs actually went.', source='BUSINESS_PLAN.md.')
I('idea-deposit', 'Deposit to book, balance on completion', 'For customers wary of paying in full up front.', source='BUSINESS_PLAN.md risks.')
I('idea-guarantee', '“Booked in 5 days or full refund”', 'A guarantee that makes paying up front feel safe.', source='BUSINESS_PLAN.md risks.')
I('idea-assign', 'Office assigns a worker directly', 'For urgent or unclaimed jobs.', source='BUSINESS_PLAN.md risks.')
I('idea-rebook', 'Book the same worker again', 'Customers can request a worker they liked for a new job.')
I('idea-spot-checks', 'Spot checks on finished work', 'Random quality checks beyond the CoC.', source='BUSINESS_PLAN.md risks.')
I('idea-instant-pay', 'Faster payouts', 'Pay workers sooner than the weekly payroll run.')
I('idea-regions', 'Expand beyond Invercargill', 'Coverage areas per region, waitlist demand map to choose where next.')
I('idea-native', 'Native phone apps', 'iOS/Android apps once the web app proves out (the 2022 iOS app lives on the old repo’s main).')
I('idea-photo-ai', 'AI reads photos to suggest hours and materials', 'Use an image model to pre-fill estimates or spot missing photos.', source='Linked to **Decide: who builds the AI pricing model**.')
I('idea-customer-ratings', 'Workers rate customers', 'Private ratings so workers can avoid problem jobs.')
I('idea-referrals', 'Referrals', 'Credit for customers and workers who bring others.')
