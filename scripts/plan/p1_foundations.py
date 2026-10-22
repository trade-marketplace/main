from base import E, F, T, D

# ---------------------------------------------------------------- EPICS
E('setup', 'Project setup & tooling', 'setup', 'The app scaffold, CI, preview links, screenshots on every PR, test tools, and the helpers that let many agents work at once.', 0)
E('decide', 'Founder decisions', 'setup', 'Questions only Matt and William can answer. Each one blocks the tasks that need its answer.', 0)
E('ds', 'Design system & app shell', 'design-system', 'Tokens, fonts, icons, every shared component, the three navigation shells and the named animations, built once so every page uses the same parts.', 0)
E('core', 'Data model & server core', 'backend', 'The database, the job status machine, pricing, who-can-see-what rules, uploads, maps, notifications and scheduled jobs.', 0)
E('auth', 'Accounts & sign-in', 'auth', 'Sign up (customer and worker), log in, verify email, reset password, sessions, roles and account settings.', 0)

# ---------------------------------------------------------------- DECISIONS
F('decide-tech', 'decide', 'Technical choices (William)', 'Stack and service choices that unblock the build.')
D('dec-hosting', 'Decide: hosting and database', 'Where does the app run and which database do we use? The prototype used SQLite and a disposable Render preview; real users need a hosted database with backups.',
  ['Vercel (app + preview link per PR) + Neon or Supabase Postgres', 'Render web service + Render Postgres (closest to the prototype)', 'Fly.io + managed Postgres'],
  'Blocks the scaffold’s database setup, preview deployments and every schema task.', owner='william')
D('dec-storage', 'Decide: file storage for photos and documents', 'Where do job photos, CoC PDFs and licence documents live? They must be private with expiring links.',
  ['Cloudflare R2', 'AWS S3', 'Supabase Storage', 'Vercel Blob'], 'Blocks the upload service.', owner='william')
D('dec-auth', 'Decide: how sign-in works', 'Port the prototype’s own email + password sessions (bcrypt + jose), or use a library/service?',
  ['Port the prototype’s sessions (no new service, we own it)', 'Auth.js (open source, adds magic links and Google/Apple sign-in later)', 'Clerk or similar (fastest, monthly cost, data held by them)'],
  'Blocks the sessions task and every sign-up/log-in page.', owner='william')
D('dec-jobs', 'Decide: how scheduled jobs run', 'Several rules run on a timer: auto sign-off after 48h, quote bounties expire after 24h, reminders, unclaimed-job alerts. What runs them?',
  ['Vercel Cron / Render Cron hitting a protected route every few minutes', 'A queue service (Inngest, Trigger.dev, QStash)', 'A small always-on worker process'],
  'Blocks the scheduler task.', owner='william')
D('dec-monitoring', 'Decide: error tracking and logs', 'How do we find out when something breaks in production?',
  ['Sentry (free tier)', 'Hosting provider logs only', 'Better Stack / Logtail'], owner='william', ms=3, prio='P2')
D('dec-rates', 'Decide: launch rates (shared rate + Other rate)', 'Decided: one shared rate + an Other rate at launch, configurable. Still needed: the actual numbers (worker $/hr for licensed trades and for Other, margin, minimum hours) and William’s revised pricing structure.',
  ['Keep $60/hr, 20% margin, 2h minimum for licensed trades; set a lower Other rate', 'Use William’s new pricing structure (write it up here)'], 'Blocks pricing settings defaults and seed data.', owner='william')

F('decide-biz', 'decide', 'Business rules (both founders)', 'The open questions from DECISIONS.md.')
D('dec-email-sms', 'Decide: email and SMS provider + sender names', 'Which service sends emails and texts, and what do they come from (e.g. “Trade Marketplace <hello@…>”, SMS sender “TradeMkt”)?',
  ['Resend (email) + Twilio (SMS)', 'Postmark (email) + Twilio', 'AWS SES + SNS (cheapest, more setup)', 'Web push only for tradie pings at first, SMS later'],
  'Blocks the notification service’s email/SMS channels. In-app notifications can be built without it.')
D('dec-ai-fair', 'Decide: AI pricing thresholds and what counts as a “fair” quote', 'When is the AI confident enough to price a job itself, when does it ask for a $30 quick look, and how far from the AI’s prediction can a quote be before it’s ignored as unfair?',
  ['Start rules-based: price when ≥3 estimates agree within ±20%; quick look when they spread >40% or the category is Other with no menu match; quote is fair within ±25% of the prediction', 'Office prices everything during the pilot; the AI only suggests', 'Something else: write it here'],
  'Blocks AI pricing v0, the fairness check and first dibs.', ms=2)
D('dec-2pct', 'Decide: what the quoter’s 2% is a share of, and the weekly bonus', 'Verified quoters earn $30 per quote + 2% when their price is accepted, fair and the job finishes without a dispute + a weekly accuracy bonus. 2% of what (labour only, the whole job ex GST, incl GST)? How big is the bonus and what counts as “accurate”?',
  ['2% of the job price ex GST; bonus $50/week for ≥5 quotes within ±10% of the final price', '2% of labour only', 'Something else'], 'Blocks quoter earnings.', ms=5, prio='P2')
D('dec-bounty-edge', 'Decide: when a bounty expires or the customer says no to the $30 quick look', 'What happens if nobody claims a quote bounty within 24h? And if the customer won’t pay the $30 quick look?',
  ['Expired: office is alerted and can raise the bounty or visit themselves; customer told “we’re finding someone”', 'Expired: refund the $30 and close the job', 'Declines $30: job closes politely with “we can’t price this from photos”', 'Declines $30: office prices it from photos anyway'],
  'Blocks bounty expiry and the quick-look decline path.', ms=2)
D('dec-ai-builder', 'Decide: who builds the AI pricing model, and when', 'Rules-based v0 can be built by agents now. A trained model needs real job data. Who owns it and when do we switch?',
  ['Rules-based v0 now, revisit after 100 completed jobs', 'Use an LLM to read photos + description and suggest hours/materials (needs a cost check)', 'Bring in a data person later'], ms=2, prio='P2')
D('dec-legal', 'Get legal advice: restricted work, liability and contracts', 'A lawyer must confirm: (1) how we check licences for restricted work (electrical, plumbing, gasfitting, drainlaying, restricted building work); (2) platform liability and the Consumer Guarantees Act; (3) worker employment vs contractor (the plan says casual employees); (4) terms of use, worker terms, privacy policy.',
  ['NZ lawyer who does marketplace / employment work', 'Start with templates, lawyer reviews before launch'], 'Blocks the legal pages, worker terms acceptance at sign-up, and launch.', ms=3)
D('dec-licence-check', 'Decide: how licences are checked', 'Restricted trades need a licence on file before claiming. How does the office check one?',
  ['Office looks the number up on the public registers (EWRB for electrical, PGDB for plumbing/gas/drainlaying, LBP for building) and ticks it', 'Worker uploads a photo of the licence card too', 'Automated register lookup later'], 'Blocks licence verification.', ms=1)
D('dec-payroll', 'Decide: how workers are paid (payroll provider)', 'The plan pays workers as casual employees through payroll (PAYE, 8% holiday pay, KiwiSaver, ACC), crews paid their share. Which payroll provider, and what export does it need?',
  ['Xero Payroll (CSV import)', 'Employment Hero / Smartly / iPayroll', 'Manual payroll from the CSV during the pilot'], 'Blocks the payroll export format.', ms=1)
D('dec-materials', 'Decide: materials for non-electrical jobs', 'Electrical materials go on the Telfer trade account under the job number. What about plumbing, building and Other jobs?',
  ['Trade accounts with other suppliers (e.g. Plumbing World, PlaceMakers) under the same job number', 'Worker buys and is reimbursed against the budget with a receipt', 'Customer supplies materials for Other jobs'], 'Blocks the materials part of “finish job” for non-electrical trades.', ms=1)
D('dec-domain', 'Decide: domain name', 'Which domain (e.g. trademarketplace.co.nz)? Needed for email sending, Apple Pay and launch.', ['.co.nz', '.nz', '.com'], owner='matt', ms=3)
D('dec-analytics', 'Decide: analytics and cookies', 'Do we track visits at launch? This decides whether the cookie banner needs choices.',
  ['No analytics at launch (banner just informs)', 'Privacy-friendly (Plausible/Fathom, no cookie consent needed)', 'Google Analytics (needs consent choices)'], owner='matt', ms=3, prio='P2')

# ---------------------------------------------------------------- SETUP
F('setup-repo', 'setup', 'App scaffold and CI')
T('scaffold', 'Scaffold the Next.js app', 0, size='M', labels=['needs-william', 'port-from-old-repo'],
  what='Create the web app in this repo: Next.js (App Router), TypeScript strict, ESLint, the database client, and npm scripts `dev`, `build`, `start`, `lint`, `typecheck`, `test`, `db:migrate`, `db:seed`. Folder layout: `src/app` (routes), `src/components` (UI), `src/server` (server-only logic), `src/lib` (shared helpers), `prisma/`, `tests/`.',
  why='Every other task builds on this. Agents need a known layout so they put code in the same places.',
  ac=['`npm run dev` shows a placeholder home page', '`npm run lint`, `typecheck`, `test`, `build` all pass on a clean clone', '`.env.example` lists every variable with a comment; the app fails fast with a clear message if one is missing', 'README “Run it locally” section added (3–5 steps)', 'Folder layout documented in a short `docs/ARCHITECTURE.md`'],
  ifs=['What if the database isn’t running? `npm run dev` prints how to start it instead of a stack trace', 'What if someone uses a different Node version? `engines` + `.nvmrc` pin it'],
  notes='Port `package.json` scripts, ESLint config and tsconfig from `willimobro/Trade-Marketplace` (Next 15, React 19, Prisma, zod, jose, bcryptjs). Switch the database to whatever **Decide: hosting and database** chooses.',
  deps=['dec-hosting'])
T('ci', 'CI: run lint, typecheck, test and build on every PR', 0, size='S', labels=['needs-william'],
  what='GitHub Actions workflow that runs the four checks on every pull request and on `main`.',
  ac=['Runs on PRs and pushes to main', 'Caches npm so a run takes under 5 minutes', 'Spins up a throwaway database for tests', 'A failing check shows which step failed'],
  ifs=['What if a PR only changes docs? Skip the heavy steps (paths filter) so it’s fast'], deps=['scaffold'])
T('pr-gate', 'PR gate: block PRs that skip the rules', 0, size='S',
  what='A GitHub Action that fails a PR when: the description has no `Closes #<issue>`; any checkbox in the description is unticked; a PR labelled or touching UI files has no images in the description. Posts a short comment saying what’s missing.',
  why='AI agents tend to do the bare minimum and stop. This makes “done” visible and checkable.',
  ac=['Fails with a clear comment for each missing item', 'Passes when everything is ticked and linked', 'Re-runs when the PR description is edited'],
  ifs=['What if a founder needs to merge anyway? A `skip-gate` label bypasses it', 'What if the PR closes several issues? Accept multiple `Closes #`'], deps=['ci'])
T('preview', 'Preview link for every PR', 0, size='S', labels=['needs-william', 'human-only'],
  what='Connect the hosting provider so every PR gets its own preview URL (with seed data and demo logins) and `main` deploys automatically.',
  why='Matt reviews screens by clicking through them, not by reading code.',
  ac=['Every PR shows a preview link in a comment', 'Previews use a throwaway database seeded with demo data, never production data', 'Preview is password-protected or uses demo accounts only', 'Payments in previews are always test mode'],
  ifs=['What if a preview build fails? The PR shows it as a failed check'], deps=['scaffold', 'dec-hosting', 'seed'], owner='william')
T('shots', 'Screenshots on every UI PR', 0, size='M',
  what='A CI job that, for PRs labelled `ui` or touching `src/app`/`src/components`, starts the app with seed data, logs in as the right demo role, screenshots every changed route at 1440 and 390 px (plus listed states via query flags), and posts them in a PR comment. Images are kept 7 days.',
  why='Matt checks every screen against the mockup from pictures. Screenshots can’t be faked by an agent claiming “done”.',
  ac=['Detects changed routes from changed files (or a `screenshots:` list in the PR description)', 'Logs in as customer / tradie / office as the route needs', 'Posts one comment with a table: route · 1440 · 390', 'Artifacts retained 7 days; adds under 3 minutes to CI', 'Reduced motion on so screenshots are stable'],
  ifs=['What if a route needs a job in a particular status? Seed data includes one job in every status; the route list maps to them', 'What if the app fails to start? The job fails with the server log attached'],
  deps=['ci', 'seed'])
T('test-tools', 'Test tooling: unit, end-to-end and accessibility', 0, size='M',
  what='Set up the unit test runner, Playwright end-to-end tests and automatic axe accessibility checks, with one example of each.',
  ac=['`npm test` runs unit tests; `npm run e2e` runs Playwright against a seeded app', 'An axe check helper fails the test on any violation', 'Example e2e: log in as each role and see the home page', 'Docs: how to write each kind of test'],
  ifs=['What if tests share a database? Each test file gets an isolated schema or transaction rollback'], deps=['scaffold'])
T('seed', 'Seed data: demo accounts and a job in every status', 0, size='M', labels=['port-from-old-repo'],
  what='A seed script that creates: demo customer, demo tradie (verified electrical), demo Other worker (unverified), demo office user; Invercargill addresses; at least one job in every status (REVIEW, QUOTE_BOUNTY, PRICED, BOOKABLE, ASSIGNED, ASSIGNED with extra work, SUBMITTED, COMPLETED, CANCEL_REVIEW, CANCELLED) across the five categories, with photos.',
  why='Previews, screenshots and tests all need realistic data in every state.',
  ac=['`npm run db:seed` is idempotent (safe to run twice)', 'Uses example figures only, clearly fake names/emails (`@demo.test`)', 'Demo passwords come from an env variable, never committed'],
  ifs=['What if seed runs against production? It refuses unless `ALLOW_SEED=1` and the database name contains “preview” or “local”'],
  notes='Port `prisma/seed.ts` and the demo photos from the old repo.', deps=['schema-jobs'])
T('next-task', 'Helper: “what should I work on next?” for agents', 0, size='S',
  what='`npm run next-task` (and a doc snippet) lists open, unassigned, unblocked tasks in milestone and priority order, excluding epics, decisions, ideas and human-only.',
  ac=['Prints number, title, milestone, priority, size', 'Works with the `gh` CLI using the repo’s REST API', 'AGENTS.md links to it'], deps=['scaffold'], ui=False)

# ---------------------------------------------------------------- DESIGN SYSTEM
F('ds-base', 'ds', 'Tokens, type and icons')
T('ds-tokens', 'Tokens, fonts and modes in the app', 0, size='S', labels=['needs-matt'],
  what='Bring `docs/design/tokens.css` into the app as the single source of colours, type, spacing, radius, shadow and motion tokens. Self-host Roboto Flex as `Trade Display` (wght 900, wdth 151, opsz 28) and `Trade UI`, and Material Symbols Rounded. Set `data-mode` on `<html>` from the user’s role: CUSTOMER → customer, TRADIE → trade, ADMIN → office; signed out → customer.',
  ac=['No hex colours anywhere outside the tokens file (add a lint rule)', 'Fonts load with `font-display: swap` and are preloaded', 'Switching role switches the palette with no flash', 'A `/dev/tokens` page (dev only) shows every token for checking'],
  ifs=['What if the icon font fails to load? Icons have text labels or aria-labels so nothing becomes meaningless'], deps=['scaffold'], ui=True)
T('ds-motion', 'Motion utilities for the named animations', 0, size='S',
  what='Shared CSS/utility classes and hooks for the named animations M01–M27 (see WEBAPP_SPEC.md “Motion”), honouring `prefers-reduced-motion`.',
  ac=['Each animation has one implementation used everywhere', 'Reduced motion turns everything into instant changes (skeleton becomes static grey)', 'Only transform/opacity animated (plus clip-path for M09)', 'Celebrations (M09, M10) only run once per event'],
  deps=['ds-tokens'], ui=True)

F('ds-comp', 'ds', 'Components')
for k, title, what in [
    ('ds-buttons', 'Buttons and links', 'Primary, secondary, tertiary, hero, destructive, icon button, link. Sizes, loading (spinner keeps width), disabled with reason tooltip. Forest labels on coloured fills.'),
    ('ds-forms', 'Form fields', 'Text, email, password (show/hide), number, money, phone, textarea with counter, select, checkbox, radio, toggle, chips (single/multi), date and time-window picker, address autocomplete shell, field errors next to the field, helper text. Values preserved on error.'),
    ('ds-cards', 'Cards, tiles and rows', 'Job tile (photo, title, suburb, distance, status, earn/price), category tile (incl. “Other (anything)”), job row, stat card, KPI card, profile card, empty card. Hover lift (M03).'),
    ('ds-status', 'Status pills, tracker and price block', 'Status pill with the label map (server status → customer / tradie / office label from sitemap.json `job_statuses`), job tracker (M11), price block with reveal (M09), gold bounty pill.'),
    ('ds-overlays', 'Dialogs, drawers, sheets, menus and toasts', 'Dialog (M13), drawer (M12), bottom sheet (phone), dropdown menu, toast with undo (M14), banner (info/warning/error/test-mode). Focus trap and return; Esc closes; scroll lock.'),
    ('ds-feedback', 'Loading, empty and error states', 'Skeletons (M15, 300 ms delay), empty states with illustration + action, inline and full-page errors with retry, offline banner hook.'),
    ('ds-data', 'Tables, tabs, pagination and filters', 'Office tables (sortable, sticky header, row actions, bulk select), tabs/segmented (M16), pagination, filter bar with chips and saved filters.'),
    ('ds-media', 'Upload, photos and avatars', 'Drop zone (M26), photo picker with previews, progress ring and retry (M18), photo viewer/lightbox, avatar with initials fallback, stars rating.'),
    ('ds-map', 'Map pins and map card', 'Map pin variants: claim (Forest), estimate (white), in-person/visit (action), bounty (gold, M27 shimmer, countdown), cluster; hovered pin grows (M21); the map + list card layout. Map provider wiring is a separate task.'),
]:
    T(k, f'Component set: {title.lower()}', 0, size='M', labels=['needs-matt'], what=what,
      ac=['Built from tokens; matches `docs/design/components.css` / `web.css` and the Effects & Components pages of the Web App Design Spec', 'Every variant and state shown on a `/dev/components` page', 'Accessible names, roles and keyboard support', 'Used by at least one real page before the PR merges, or has a usage example'],
      ifs=['What if text is very long (names, suburbs, job titles)? Truncate with tooltip or wrap; never overflow', 'What if the user zooms to 200%? Still usable'],
      deps=['ds-tokens', 'ds-motion'], ui=True)

F('ds-shell', 'ds', 'Navigation shells')
T('ds-shell-site', 'Public site header and footer', 0, size='S', what='Transparent site nav that turns solid Forest after the hero (M06), mobile menu, “Post a job” and “Are you a tradie?” entries, log in; footer with links to all public and legal pages.',
  mock='w-landing', deps=['ds-buttons'], ui=True)
T('ds-shell-app', 'App navigation for customers and tradies', 0, size='M',
  what='Signed-in shell: desktop top nav and phone bottom nav, per mode. Customer: Home, My jobs, Messages, + Post a job. Tradie: Find work (list | map), My work, Earnings, Messages. Bell with badge (M20), avatar menu (account, help, log out), test-mode banner when payments are in test mode.',
  ac=['Active tab indicator (M16)', 'Bottom nav respects the phone safe area; content never hidden behind it', 'Skip link to main content'],
  mock='w-c-home', deps=['ds-buttons', 'ds-overlays'], ui=True)
T('ds-shell-office', 'Office shell', 0, size='S',
  what='Office (admin) shell in Forest/Mint: left sidebar with Queues, All jobs, Tradies, Customers, Payouts, Payments, Reviews, Support, Settings; queue counts; collapses to a top menu under 1024 px.',
  mock='w-o-queues', deps=['ds-buttons', 'ds-data'], ui=True)

# ---------------------------------------------------------------- CORE
F('core-db', 'core', 'Database schema', 'Schema tasks run one after another to avoid migration clashes.')
T('schema-users', 'Schema 1: users, roles, worker profiles, trades and licences', 0, size='M', labels=['needs-william', 'port-from-old-repo'],
  what='Tables for users (role CUSTOMER | TRADIE | ADMIN; email verified; phone), worker profile (bio, work area centre + radius, available flag, verified badge, quoter flag for later), trades the worker does (incl. OTHER), licences (trade, number, type, status pending/verified/rejected with reason, checked by, checked at, document), saved addresses, sessions.',
  ac=['Migration runs on a fresh database', 'Indexes for login by email and for finding workers by trade + area', 'Sensitive fields (IRD number, bank account) stored encrypted at rest (key from env)'],
  ifs=['What if a worker does several trades with different licence states? Licence status is per trade', 'What if an email is entered with capitals? Stored lowercased, unique'],
  notes='Start from `prisma/schema.prisma` `User` in the old repo.', deps=['scaffold'])
T('schema-jobs', 'Schema 2: jobs, photos, time windows, estimates and pricing', 0, size='M', labels=['needs-william', 'port-from-old-repo'],
  what='Jobs (job number TM-####, customer, category ELECTRICAL | PLUMBING | GAS | CONSTRUCTION | OTHER, title, description, address + lat/lng + suburb, access notes, ASAP flag, status incl. QUOTE_BOUNTY, assigned worker, pricing snapshot fields copied from settings), photos, the customer’s time windows (date × morning/afternoon/evening, “any time”), the booked window, estimates (blind, one per worker per job), status history.',
  ac=['Money stored in cents (integers)', 'Rates copied onto the job when priced, so later settings changes never change an agreed price or payout', 'Status history row written on every status change'],
  ifs=['What if a job is edited after estimates exist? Keep an `editedAt` and flag estimates made before the edit', 'What if the same worker estimates twice? Unique (job, worker): second save updates'],
  deps=['schema-users'])
T('schema-money', 'Schema 3: payments, extra work, payouts and settings', 0, size='M', labels=['needs-william', 'port-from-old-repo'],
  what='Payments (kind JOB | VARIATION | QUICK_LOOK, provider ids, status PENDING | PAID | FAILED | REFUNDED | PARTIALLY_REFUNDED, idempotency key), extra work / variations (REQUESTED → PRICED → APPROVED | DECLINED), payouts (per worker per job: hours, rate, gross, holiday pay, status QUEUED | EXPORTED | PAID), materials budget + actual spend, settings (shared rate, Other rate, on-costs, margin, GST, minimum hours, auto-release hours, quick-look price, bounty expiry hours, coverage area).',
  ac=['A job can have several payments (job + extras + quick look) and several payouts (crews later)', 'Settings has one row with defaults from **Decide: launch rates**'],
  ifs=['What if a payment is refunded in part? Track refunded cents separately'], deps=['schema-jobs', 'dec-rates'])
T('schema-after', 'Schema 4: completion evidence, reviews, notifications, support and audit log', 0, size='M', labels=['needs-william'],
  what='Completion evidence (CoC number + file for electrical; photos + notes for others; declaration; materials spent), reviews (1–5, comment, editable 7 days), notifications (user, type, payload, read at, channels sent), problem reports and support threads, audit log (who did what to which record, when, before/after).',
  ifs=['What if a review is reported? Add `hiddenAt`/`hiddenReason` for office moderation'], deps=['schema-money'])

F('core-logic', 'core', 'Server logic')
T('status-machine', 'Job status machine with guards', 0, size='M', labels=['needs-william', 'port-from-old-repo'],
  what='One module that owns every job status change: allowed transitions, who may trigger each (customer / worker / office / system), what must be true first, and what happens after (history row, audit, notifications). Includes QUOTE_BOUNTY.',
  ac=['Every transition in the sitemap’s `job_statuses` is covered', 'Illegal transitions throw a typed error and change nothing', 'Runs inside a database transaction'],
  ifs=['What if two people act at once (two workers claim, customer cancels while worker claims)? Row lock / conditional update so only one wins', 'What if the customer cancels after paying? → CANCEL_REVIEW, worker sees “On hold”', 'What if the office needs to force a status? Office override, always logged with a reason'],
  tests=['A test per allowed transition and per forbidden one', 'A concurrency test for claim vs cancel'],
  notes='Port `src/lib/jobs.ts` and `payment-eligibility.ts` from the old repo.', deps=['schema-after'])
T('pricing', 'Pricing engine', 0, size='S', labels=['needs-william', 'port-from-old-repo'],
  what='Port the price-building maths: worker gross = hours × rate; on-costs; materials at cost; TM margin; GST; minimum hours. Add the Other rate. Output both the customer price and what the worker earns.',
  ac=['Same results as the old repo’s `pricing.test.ts` for the same inputs', 'Rates frozen onto the job when priced', 'Rounding rules documented and tested (cents)'],
  ifs=['What if hours are below the minimum? Minimum applies to the customer price and the worker pay', 'What if materials are zero? Margin on labour only'],
  notes='`src/lib/pricing.ts` + `tests/pricing.test.ts` in the old repo.', deps=['schema-money'], ui=False)
T('visibility', 'Who-sees-what rules (data views per role)', 0, size='M', labels=['needs-william'],
  what='Central functions that turn a job into what each person may see. Customer view: never estimates, averages, margins or worker earnings. Worker view: what they earn, never the customer price; exact address and customer phone only after they claim. Office: everything. Public: nothing private.',
  why='One leak (a customer seeing estimates, a worker seeing the margin, an address before claiming) breaks trust. Doing it in one place makes it testable.',
  ac=['Every page and API returns data only through these views', 'Approximate location (suburb + fuzzed pin ±300 m) for unclaimed jobs'],
  ifs=['What if a worker is unassigned or loses the job? Address and phone hidden again', 'What if someone guesses another job’s id in the URL? 404, not 403 (don’t confirm it exists)'],
  tests=['Snapshot tests of each view for a job in every status', 'A test that fails if a customer view contains any estimate or margin field'], deps=['status-machine'])
T('uploads', 'Upload service for photos and documents', 0, size='M', labels=['needs-william'],
  what='Upload to private storage, get short-lived links to view. Photos: resize, strip location/EXIF data, max 10 per job, 10 MB each, JPG/PNG/HEIC. Documents (CoC, licences): PDF or image, 10 MB.',
  ac=['Files are never public; links expire', 'Only people allowed to see the job can view its files', 'HEIC from iPhones converted to JPEG'],
  ifs=['What if the upload drops halfway? Retry without duplicates', 'What if someone uploads a file pretending to be a photo? Check the real file type, reject', 'What if the photo contains GPS location? Always stripped'],
  deps=['schema-after', 'dec-storage'], ui=False)
T('geo', 'Addresses, coverage area and distances', 0, size='M',
  what='Address autocomplete and geocoding (Mapbox), coverage check (Invercargill at launch, configurable in settings), distance from worker to job, approximate pins for unclaimed jobs.',
  ac=['Autocomplete limited to NZ and biased to the coverage area', 'Coverage stored as centre + radius (or polygon) in settings', 'Distance shown in km rounded'],
  ifs=['What if the address isn’t found (new subdivision, rural)? Allow manual entry + pin drop, flagged for office', 'What if Mapbox is down? Address can still be typed; coverage checked later by office', 'What if the job is just outside the area? Waitlist page (A07), job not posted'],
  notes='Old repo has `distance.ts` and `demo-distances.ts`.', deps=['schema-jobs'], ui=False)
T('notify', 'Notification service (in-app first, email/SMS/push pluggable)', 0, size='M',
  what='One `notify(event, recipients, data)` call used by every feature. Writes in-app notifications now; email, SMS and web push plug in once providers are chosen. Respects each user’s preferences. Event catalogue documented (posted, priced, paid, claimed, window booked, on my way, running late, extra work, submitted, signed off, auto-completed, payout queued, bounty available, crew invite, …).',
  ac=['Adding a channel doesn’t change callers', 'Each event lists which channels it uses by default', 'Failed sends retried, then logged'],
  ifs=['What if a user turned a channel off? Skip it but keep in-app', 'What if the same event fires twice? De-duplicate by event id'],
  deps=['schema-after'], ui=False)
T('notify-email', 'Email and SMS channels', 1, size='M', labels=['needs-william'],
  what='Wire the chosen providers into the notification service. Email templates follow the Emails page (G05); SMS copy follows G06.', deps=['notify', 'dec-email-sms'],
  ifs=['What if an email bounces? Mark the address unverified and show a banner asking them to fix it', 'What if a phone number is invalid? Store it but don’t SMS; flag in profile'], ui=False)
T('scheduler', 'Scheduled jobs runner', 0, size='S', labels=['needs-william'],
  what='The timer that runs time-based rules: auto sign-off 48h after submission, quote bounty expiry (24h), unclaimed job alert (>48h), “taking >24h” price banner, review reminder.',
  ac=['Each rule is a small idempotent function with a test', 'Safe if it runs twice or late', 'Protected endpoint / worker, never callable by the public'],
  ifs=['What if the runner was down for a day? On restart it catches up in order'], deps=['status-machine', 'dec-jobs'], ui=False)
T('audit', 'Audit log helper', 0, size='S', labels=['needs-william'],
  what='`audit(actor, action, record, before, after, reason?)` used by every office action and every money change.', deps=['schema-after'], ui=False)
T('ratelimit', 'Rate limits and abuse protection', 1, size='S', labels=['needs-william'],
  what='Limits on log-in attempts, sign-ups, password resets, job posting, uploads and messages; friendly errors.', ifs=['What if a real user hits a limit? Message says when they can try again'], deps=['sessions'], ui=False)

# ---------------------------------------------------------------- AUTH
F('auth-core', 'auth', 'Sessions and roles')
T('sessions', 'Sessions, passwords and route protection', 0, size='M', labels=['needs-william', 'port-from-old-repo'],
  what='Email + password sign-in with secure, http-only session cookies; log out; roles; middleware that protects app routes and sends people to the right home (customer `/`, tradie `/jobs`, office `/admin`).',
  ac=['Passwords hashed (bcrypt or argon2); minimum 10 characters, checked against common passwords', 'Session cookies http-only, secure, same-site; rotate on log-in', 'CSRF-safe forms', 'Role checks on every server action, not just pages'],
  ifs=['What if a tradie opens a customer-only page? Redirect to their home', 'What if the session expires mid-form? Session-expired dialog (B07); form values kept'],
  notes='Old repo `src/lib/session.ts` (jose). Follow **Decide: how sign-in works**.', deps=['schema-users', 'dec-auth'])
T('login', 'Log in page', 0, pages=['B01'], labels=['port-from-old-repo'],
  ifs=['What if the email isn’t verified? Log in works, banner asks them to verify; posting/claiming blocked until verified', 'What if they mistype 5 times? Locked for 15 minutes with a message (not “wrong password”, which leaks existence)', 'What if they arrive from a deep link? Return them there after log-in'],
  deps=['sessions', 'ds-forms', 'ds-shell-site'])
T('signup-choose', 'Sign up: choose customer or tradie', 0, pages=['B02'], deps=['sessions', 'ds-cards'])
T('signup-customer', 'Sign up: customer details', 0, pages=['B03'],
  ac=['Accept the terms of use and privacy policy (links) before creating the account'],
  ifs=['What if they came from the post-a-job wizard? Their draft job is kept and posted after sign-up', 'What if the email is taken? Offer log in / reset, keep the other fields'],
  deps=['signup-choose'])
T('signup-tradie', 'Sign up: tradie / worker details', 0, pages=['B04'],
  ac=['Trades chips include Electrical, Plumbing, Gas fitting, Construction and “Other / general labour”', 'Licence number asked only for restricted trades; Other needs no licence', 'Accept worker terms (link) before creating the account'],
  ifs=['What if they only pick Other? No licence step; they can take Other jobs once verified basics (email, phone) are done', 'What if the licence number format is wrong? Inline error with an example'],
  deps=['signup-choose'])
T('verify-email', 'Verify email', 0, pages=['B05'],
  ifs=['What if the link expired? Resend button', 'What if they’re already verified? Friendly “You’re all set” and continue'],
  deps=['sessions', 'notify'])
T('recovery', 'Forgot and reset password', 0, pages=['B06'], labels=['port-from-old-repo'],
  ifs=['What if the email doesn’t exist? Same message as success (don’t reveal accounts)', 'What if the link is reused? Invalid; sessions on other devices end after a reset'],
  notes='Old repo `src/app/recovery`.', deps=['sessions', 'notify'])
T('session-expired', 'Session expired dialog', 0, pages=['B07'], deps=['sessions', 'ds-overlays'])
T('twofa', 'Two-step verification (optional)', 3, prio='P3', pages=['B08'], labels=['needs-william'],
  ifs=['What if they lose their phone? Backup codes'], deps=['sessions'])

F('auth-account', 'auth', 'Account settings')
T('acct-profile', 'Account: profile', 1, pages=['E04'], ifs=['What if they change their email? Re-verify the new address before switching'], deps=['sessions', 'uploads', 'ds-shell-app'])
T('acct-security', 'Account: security', 1, pages=['E05'], ifs=['What if they change their password? Other sessions end'], deps=['sessions', 'ds-shell-app'])
T('acct-notifs', 'Account: notification preferences', 1, pages=['E06'], deps=['notify', 'ds-shell-app'])
T('acct-delete', 'Account: delete account and export my data', 3, prio='P2', pages=['E07'], labels=['needs-william'],
  ifs=['What if they have an active or unpaid job? Blocked with the reason and what to do', 'What about records we must keep (tax invoices, payroll)? Kept, personal details anonymised; explained on the page'],
  deps=['acct-profile'])
