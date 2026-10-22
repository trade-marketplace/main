# Trade Marketplace — Web App Design Spec (v1.0, October 2026)

Text version of the PDF, for developers and AI agents. Live HTML of every designed page: `pages.html`. Styles: `tokens.css` + `components.css` (from the Front-End Build Guide) + `web.css` (desktop layer, effects, motion). The mobile (390px) screens stay in the Front-End Build Guide.

This spec says **what** to build. How is the developer’s call. All prices, names, ratings and counts are examples; real values come from the server. Business rules don’t change because of anything drawn here.

## Ten web rules

1. **Same components, wider layouts.** Desktop rearranges the mobile components. It doesn’t invent new styles. Anything new goes into web.css with a name.
2. **Content max 1200px, centred.** 12 columns, 24px gutters. Reading text max 680px. Forms max 560–760px, one column.
3. **One main action per view.** One primary or hero button per screen or card. Everything else is secondary, ghost or a link.
4. **Sticky where it helps.** App nav sticky. On job pages the status card sticks to the right as you scroll. Wizard summary sticks.
5. **Everything clickable shows it.** Pointer cursor, a hover state and a focus ring. Cards lift (M03), rows tint, links underline.
6. **Hover never hides information.** Nothing important only appears on hover (touch screens and keyboards can’t hover). Hover only adds polish.
7. **Keyboard first-class.** / focuses search, Esc closes overlays, Enter submits, arrows move in galleries and steppers. Tab order follows reading order.
8. **Drawers for side tasks, dialogs for decisions.** Estimate and extra work open in a right drawer (keep context). Confirms and money decisions use a dialog.
9. **Brand device on every big moment.** Forest band + bolt at 20% on heroes, headers and success screens. Bolt flash (M10) only for real wins.
10. **Same URL, every device.** Every page works from 320px to 2560px. Same routes; layout adapts.

## Shells

- **Public site:** site nav 76px (transparent over hero → solid Forest after scroll), hero band, sections max 1200, footer.
- **App (customer & tradie):** app nav 68px sticky (logo · tabs · search `/` · CTA · bell · avatar), main 8 cols + side 4 cols (sticky status/summary). Below 1024 → mobile bottom nav from v1.
- **Office:** 248px Forest sidebar with Mint active + counts, KPI cards, tabs, tables / table + detail panel.

## Page inventory (tick them off)

| ✓ | # | Page | Route | What’s on it | States to design | Prio | Mockup |
|---|---|---|---|---|---|---|---|
| [ ] | A01 | Home / landing | `/` | Hero + “What needs doing?” search, how it works (3 steps), categories, popular jobs, why us (fixed price, checked tradies, no surprise bills), reviews, For tradies band, FAQ teaser, final CTA, footer | Signed-out · signed-in redirects to app home · region not covered | P1 | Home / landing |
| [ ] | A02 | How it works | `/how-it-works` | The 3 steps in detail for customers (no pricing machinery), what’s included, guarantees, FAQ, CTA | Default | P1 | How it works |
| [ ] | A03 | For tradies | `/for-tradies` | Pitch to workers: jobs already priced, no lead fees, we do the paperwork. How it works for tradies, what you earn, requirements per trade, sign-up CTA, tradie FAQ | Default (trade colours) | P1 | For tradies |
| [ ] | A04 | Service pages (per trade) | `/services/[trade]` | SEO landing per trade incl. /services/other (“Anything else”): hero, common jobs, how it works, reviews, CTA | Trade live · trade coming soon (waitlist) | P2 | Service page (template) |
| [ ] | A05 | Location pages (per city) | `/[trade]/[city]` | SEO: “Electricians in Invercargill”, local stats, suburbs covered, CTA. Same template as A04 | Covered · not covered | P3 | — |
| [ ] | A06 | Trust & safety | `/trust` | How tradies are checked, licences, CoC, insurance, payments held securely, what happens if something goes wrong, contact | Default | P1 | Trust & safety |
| [ ] | A07 | Not in your area yet | `/coming-soon` | Shown when an address is outside coverage: friendly message, waitlist email + suburb, share link | Joined · already on list | P1 | Not in your area yet |
| [ ] | A08 | About us | `/about` | Founders’ story (started 4 years ago), mission, team photos, press | Default | P2 | About & contact |
| [ ] | A09 | Contact | `/contact` | Form (topic, email, message), help-centre links, response time, business details (NZBN, address) | Sending · sent · error | P1 | About & contact |
| [ ] | A10 | Help centre home | `/help` | Search, topic cards (Customers, Tradies, Payments, Account), popular articles, contact | Search results · no results | P1 | Help centre + article |
| [ ] | A11 | Help article | `/help/[slug]` | Breadcrumbs, article, “Was this helpful?” yes/no, related articles, contact | Helpful voted | P1 | Help centre + article |
| [ ] | A12 | Public tradie profile | `/tradies/[id]` | Photo, first name, trade(s), region, verified badges, rating, jobs done, reviews | No reviews · paused tradie (404) | P2 | Public tradie profile |
| [ ] | A13 | Terms of use (customers) | `/legal/terms` | Long-form legal template: sticky contents, sections, last updated | — | P1 | Legal pages + cookie banner |
| [ ] | A14 | Tradie terms | `/legal/tradie-terms` | Same template | — | P1 | Legal pages + cookie banner |
| [ ] | A15 | Privacy policy | `/legal/privacy` | Same template | — | P1 | Legal pages + cookie banner |
| [ ] | A16 | Cookie notice + banner | `/legal/cookies` | Banner on first visit: Accept / Only essential / Settings; settings dialog | First visit · choices saved | P1 | Legal pages + cookie banner |
| [ ] | B01 | Log in | `/login` | Split layout: brand panel left, form right (email, password, show/hide, forgot, log in, sign up link) | Error · locked (too many tries) · loading | P1 | Log in |
| [ ] | B02 | Sign up · choose | `/signup` | “I need a job done” / “I’m a tradie” cards | — | P1 | Sign up · choose + details |
| [ ] | B03 | Sign up · customer details | `/signup/customer` | Name, email, mobile, password, terms | Email taken · weak password | P1 | Sign up · choose + details |
| [ ] | B04 | Sign up · tradie details | `/signup/tradie` | Name, email, mobile, password, trades (multi, incl. Other / general labour), licence numbers for licensed trades, work area | Licence format error | P1 | Sign up · tradie details |
| [ ] | B05 | Verify email | `/verify` | Check your inbox (resend with cooldown) → verified ✓ → continue | Expired link · already verified | P1 | Verify email · reset password |
| [ ] | B06 | Forgot / reset password | `/recovery` | Request → sent → new password → done | Expired · invalid link | P1 | Verify email · reset password |
| [ ] | B07 | Session expired | `(dialog)` | Dialog over the page: “You’ve been logged out” → log in again, keeps the page and any draft | — | P1 | Dialogs |
| [ ] | B08 | Two-step verification | `/login/2fa` | Code from SMS/app. Office accounts required, others optional | Wrong code · resend | P3 | — |
| [ ] | C01 | Customer home | `/ (signed in)` | Big “What needs doing?” box, jobs needing you (action cards), active jobs, categories, recent | New user (empty) · has jobs | P1 | Customer home |
| [ ] | C02 | Post a job · describe | `/jobs/new` | Wizard: steps rail left, form centre, live summary card right. Description + type: main trades + Other (any labour: moving, cleaning, gardening, assembly…) | Draft restored | P1 | Post a job · describe |
| [ ] | C03 | Post a job · photos | `/jobs/new?step=photos` | Drag-and-drop zone + grid, 1–6 photos, safety tip | Uploading · failed · too big | P1 | Post a job · photos |
| [ ] | C04 | Post a job · where & when | `/jobs/new?step=where` | Address autocomplete (coverage area only) + time windows grid (next 7 days × morning/afternoon/evening), Any time, ASAP, access notes | Outside coverage → A07 | P1 | Post a job · where & when (time windows) |
| [ ] | C05 | Post a job · check & post | `/jobs/new?step=review` | Summary with edit links, hero “Post it”; signed-out → sign-up dialog | Posting · error | P1 | Post a job · check & post (+ sign-up gate) |
| [ ] | C06 | Posted (success) | `/jobs/[id]?posted=1` | Bolt-flash success, tracker, “we’ll let you know”, notification opt-in | — | P1 | Posted (success) |
| [ ] | C07 | Job · getting your price | `/jobs/[id]` | Gallery + details left, sticky status card right (tracker, edit, cancel free) | Taking > 24h banner | P1 | Job · getting your price |
| [ ] | C08 | Job · price ready | `/jobs/[id]` | Price reveal card: big price, inclusions, Accept & pay, No thanks | — | P1 | Job · price ready |
| [ ] | C09 | Decline price dialog | `(dialog)` | Optional reasons, confirm “No thanks”, job closed free | — | P1 | Dialogs |
| [ ] | C10 | Checkout | `/pay/[paymentId]` | Order summary, payment method, card fields (provider), pay button, TEST banner | Declined · 3-D Secure · processing | P1 | Checkout |
| [ ] | C11 | Payment success | `/pay/[id]/done` | Bolt flash, “Paid. You’re booked.”, receipt link, what happens next | Failed → back to checkout | P1 | Payment success |
| [ ] | C12 | Job · booked / tradie confirmed | `/jobs/[id]` | Tradie card, message, tracker, receipt | Finding someone · confirmed | P1 | Job · tradie confirmed |
| [ ] | C13 | Extra work approval | `(dialog + page state)` | Photos, description, extra cost, Approve & pay / Decline | Approved · declined | P1 | Extra work approval |
| [ ] | C14 | Job · please check (sign-off) | `/jobs/[id]` | Evidence (CoC/photos), “Yes, all sorted” / “Something’s not right”, 48h note | Auto-completed | P1 | Please check + review |
| [ ] | C15 | Leave a review | `(dialog)` | Stars, quick tags, comment, post | Posted · edit within 7 days | P1 | Please check + review |
| [ ] | C16 | Report a problem | `/jobs/[id]/problem` | Topic, details, photos; pauses auto-release | Sent | P1 | — |
| [ ] | C17 | Cancel job dialog | `(dialog)` | Before payment: free cancel. After: request (office reviews) | Requested | P1 | Dialogs |
| [ ] | C18 | My jobs | `/dashboard` | Tabs Active/Done/Cancelled, search, list/cards, status pills | Empty | P1 | My jobs |
| [ ] | C19 | Payments & receipts | `/profile/payments` | Table of payments/refunds, download invoice | Empty | P1 | Payments & invoice |
| [ ] | C20 | Invoice / receipt | `/receipts/[jobId]` | Printable tax invoice, download PDF, print styles | — | P1 | Payments & invoice |
| [ ] | C22 | Job · needs a $30 quick look | `/jobs/[id] · QUOTE_BOUNTY` | AI can’t price from photos/estimates: book a $30 quick look (comes off the price if they go ahead), pick windows, then normal price flow. New status QUOTE_BOUNTY | Booked · visited → price ready · declined | P2 | Job · needs a $30 quick look |
| [ ] | C21 | Saved addresses | `/profile/addresses` | List, add/edit dialog, default | Empty | P2 | — |
| [ ] | D01 | Tradie home · setup checklist | `/jobs (first visit)` | New tradies: checklist (verify email, licence, photo, bank & IRD, work area, alerts) + progress; then becomes the job board | Pending verification | P1 | Tradie home · setup checklist |
| [ ] | D02 | Job board · list | `/jobs` | Filters sidebar, tabs Ready to claim / Needs estimate, photo grid, sort | Empty area · not verified | P1 | Job board · list |
| [ ] | D03 | Job board · map (desktop) | `/jobs?view=map` | Uber-style: list left, map right. 3 pin kinds: ready to claim (what you earn), needs an estimate (photos), needs a site visit (in person). Filter chips with counts, legend, hover row↔pin | No location permission · nothing in view | P1 | Job board · map (desktop) |
| [ ] | D18 | Job map (phone) | `/jobs?view=map` | Full-screen map, “You’re available” switch, floating chips (All · Claim · Bounty · Estimate), gold bounty pins, bottom sheet with swipeable job cards | Available on/off · no jobs in view | P1 | Map · nearby jobs |
| [ ] | D19 | Quote bounty (quote in person) | `/jobs/[id] · QUOTE_BOUNTY` | Gold $30 bounty, 24h countdown, Claim bounty → pick a customer window → visit → send fixed price; AI checks it; first dibs if accepted + fair, ignored if way off | Claimed · expired · price sent · ignored | P2 | Quote bounty (sheet up) |
| [ ] | D20 | New job & bounty ping (when available) | `(in-app + push)` | Card over the map: distance, what you earn, time left (bounties gold), See / Skip. Quiet hours | Queued pings | P2 | New job ping (available) |
| [ ] | D21 | Lead adds a crew | `/jobs/[id] (lead)` | Crew panel on the workspace + drawer: pick from your crew or any worker, their part, share % / $ (adds to 100%), send invite | Invited · joined · declined | P2 | Lead adds a crew (team job) |
| [ ] | D22 | Crew invite (accept/decline) | `(push + in-app)` | Who’s asking, the job, your part, when, your share in $ and % | Accepted · declined · expired | P2 | Crew invite |
| [ ] | D23 | My crew | `/profile/crew` | People you work with (like friends): add, remove, trades, ratings | Empty | P2 | Lead adds a crew (team job) |
| [ ] | D24 | Need a hand? (request a specialist) | `/jobs/[id]/help` | Solo lead asks for a specialist (e.g. plumber on a bathroom reno) inside the same job, no new job | — | P3 | — |
| [ ] | D25 | Verified quoter dashboard | `/quoting` | Accuracy, bounties, 2% earnings, weekly bonus, quote history vs final price, how you earn | Not a quoter → hidden | P3 | Verified quoter dashboard |
| [ ] | D26 | Become a verified quoter | `/quoting/apply` | Invite-only application + screening steps | Invited · screening · approved · declined | P3 | — |
| [ ] | D27 | Book a time window | `/jobs/[id]/book` | Pick one of the customer’s windows; preset updates (On my way, Running late, Reschedule) instead of chat | Booked · rescheduled | P1 | Book a time window |
| [ ] | D04 | Job · needs estimate | `/jobs/[id]` | Gallery, details, “Estimate now” opens drawer | Already estimated · not eligible | P1 | Job · estimate (drawer) |
| [ ] | D05 | Estimate drawer | `(drawer)` | Hours stepper, materials, note, site visit; private banner | Saved · edit | P1 | Job · estimate (drawer) |
| [ ] | D06 | Job · ready to claim | `/jobs/[id]` | You earn card, materials budget, needs, Claim job | — | P1 | Job · claim (+ result) |
| [ ] | D07 | Claim confirm + result | `(dialog)` | Confirm → It’s yours (bolt flash) / Too slow | Lost race | P1 | Job · claim (+ result) |
| [ ] | D08 | My work | `/dashboard` | Columns: To book · On now · Waiting sign-off · Paid (read-only board), estimates tab | Empty | P1 | My work |
| [ ] | D09 | Job workspace | `/jobs/[id]` | Customer + address + map, Telfer no., tracker, messages inline, Extra work / Finish job | Waiting on extra approval | P1 | Job workspace (+ extra work drawer) |
| [ ] | D10 | Request extra work | `(drawer)` | What, photos (req), hours, materials, send for pricing | Sent · priced · approved · declined | P1 | Job workspace (+ extra work drawer) |
| [ ] | D11 | Finish job | `/jobs/[id]/complete` | Evidence photos, CoC number + PDF (electrical), declaration, send for sign-off | Upload failed · trade not configured | P1 | Finish job |
| [ ] | D12 | Earnings | `/earnings` | Month total, chart, next payroll, payouts table, payroll detail | Empty | P1 | Earnings |
| [ ] | D13 | Estimates history | `/earnings/estimates` | Table: job, your estimate, final price, outcome | Empty | P2 | — |
| [ ] | D14 | Trades & licences | `/profile/trades` | Per trade: status (checked/pending/rejected), licence no., expiry, upload, add trade | Pending · rejected with reason | P1 | Account · trades & licences + bank |
| [ ] | D15 | Bank & tax | `/profile/payroll` | Bank account, IRD number, tax code, KiwiSaver; masked after save, re-auth to edit | Missing → blocks payout | P1 | Account · trades & licences + bank |
| [ ] | D16 | Work area & job alerts | `/profile/area` | Base suburb + radius map, trades, alert channels | — | P1 | — |
| [ ] | D17 | Public profile editor | `/profile/public` | Photo, bio, preview of public profile | — | P2 | — |
| [ ] | E01 | Messages | `/messages` | 3 panes: threads · conversation · job context. Kept for problems; booking windows + preset updates replace most chat | No threads · offline | P1 | Messages |
| [ ] | E02 | Notifications dropdown | `(header)` | Bell → panel: latest 8, mark all read, see all | Empty | P1 | Notifications dropdown + avatar menu |
| [ ] | E03 | Notifications page | `/notifications` | Full list, filters (all/unread), grouped by day | Empty | P1 | — |
| [ ] | E04 | Account · profile | `/profile` | Settings layout with left nav: Profile, Security, Notifications, Addresses/Payroll, Delete account | Saving · saved | P1 | Account settings |
| [ ] | E05 | Account · security | `/profile/security` | Change email/password, sessions (log out other devices) | Wrong current password | P1 | — |
| [ ] | E06 | Account · notification preferences | `/profile/notifications` | Matrix: event × email/SMS/push | — | P1 | Account settings |
| [ ] | E07 | Delete account / export data | `/profile/delete` | Explain what happens, blocked while jobs active, type to confirm | Blocked | P2 | — |
| [ ] | E08 | Help (in app) + support thread | `/help + /support` | Same help centre, plus “Message us” thread with the office | Replied | P1 | — |
| [ ] | E09 | Global search | `(header)` | Customers: jobs + help; tradies: jobs + help; suggestions dropdown | No results | P2 | — |
| [ ] | F01 | Queues | `/admin` | KPI cards + tabbed queues: To price, Extra work, Cancellations, Sign-off, Unclaimed | All clear | P1 | Office · queues |
| [ ] | F02 | Price a job | `/admin/jobs/[id]/price` | Job, blind estimates, trimmed average, price builder, send | Site visit needed | P1 | Office · price a job |
| [ ] | F03 | Price extra work | `/admin/variations/[id]` | Photos, tradie request, builder, send to customer | — | P1 | — |
| [ ] | F04 | All jobs | `/admin/jobs` | Table with filters (status, trade, region, date), search, export | Empty filter | P1 | Office · all jobs |
| [ ] | F05 | Job admin view | `/admin/jobs/[id]` | Everything + timeline (audit), payments, messages, override actions (reassign, refund, cancel) | — | P1 | Office · job admin view |
| [ ] | F06 | Cancellations & disputes | `/admin/disputes` | Case view: both sides, evidence, decision + refund | Resolved | P1 | — |
| [ ] | F07 | Sign-off / CoC review | `/admin/signoff` | Evidence check, approve/flag | — | P1 | — |
| [ ] | F08 | Tradies | `/admin/tradies` | Table + detail panel: per-trade checks, register link, approve/reject, pause | To check · paused | P1 | Office · tradies |
| [ ] | F09 | Customers | `/admin/customers` | Table + detail: jobs, payments, notes | — | P2 | — |
| [ ] | F10 | Payouts | `/admin/payouts` | Batches, export CSV, mark paid | Nothing queued | P1 | Office · payouts |
| [ ] | F11 | Payments & refunds | `/admin/payments` | Ledger, refund dialog | — | P1 | — |
| [ ] | F12 | Reviews | `/admin/reviews` | Moderate, hide with reason | — | P2 | — |
| [ ] | F13 | Support inbox | `/admin/support` | Threads from Help → Message us | — | P1 | — |
| [ ] | F15 | AI pricing review | `/admin/pricing` | Jobs the AI couldn’t price: AI price, confidence, estimates, bounty quote, why; send / edit / post another bounty | All clear · bounty expired | P2 | Office · AI pricing review |
| [ ] | F16 | Verified quoters | `/admin/quoters` | Invite, screening checklist, accuracy, bonus payouts, remove | — | P3 | — |
| [ ] | F14 | Settings | `/admin/settings` | Rates (shared + Other at launch, per trade later), margin, AI pricing thresholds, bounty amount + expiry, quoter %/bonus, coverage (Invercargill), trades on/off, email templates | Saving | P1 | Office · settings |
| [ ] | G01 | 404 not found | `(any)` | Friendly message, search, go home | — | P1 | 404 · 500 · maintenance · offline |
| [ ] | G02 | 500 / something broke | `(any)` | Apology, try again, status link | — | P1 | 404 · 500 · maintenance · offline |
| [ ] | G03 | Maintenance | `(any)` | Planned downtime message with time | — | P2 | 404 · 500 · maintenance · offline |
| [ ] | G04 | Offline banner | `(any)` | Persistent top banner + retry; drafts kept | — | P1 | 404 · 500 · maintenance · offline |
| [ ] | G05 | Emails (transactional) | `—` | Welcome, verify, price ready, receipt, tradie confirmed, extra work, please check, review request, password reset; tradie: new job near you, claim confirmed, licence checked, paid | Light + dark mail clients | P1 | Emails & texts |
| [ ] | G06 | SMS & push copy | `—` | Short versions of key emails | — | P1 | Emails & texts |
| [ ] | G07 | Favicon, app icon, social share image | `—` | Bolt favicon (svg + png), apple-touch-icon, OG 1200×630 per page type | — | P1 | Icons, share images & install |
| [ ] | G08 | Install as app (PWA) | `—` | Manifest, theme colour Forest, splash, “Add to home screen” hint once | — | P2 | Icons, share images & install |
| [ ] | G09 | Print styles | `—` | Receipts and invoices print clean A4 | — | P1 | — |

## Motion

- Motion confirms something happened. It never makes people wait: nothing over 400ms blocks input.
- Use the tokens: --trade-dur-fast 120, --trade-dur-base 200, --trade-dur-slow 320, --trade-ease-out, --trade-ease-in-out.
- Only animate transform and opacity (plus clip-path for M09). Never width, height, top or left (except M24).
- Big celebrations (M09 price reveal, M10 bolt flash) run once per event, never on revisits or refreshes.
- prefers-reduced-motion: everything becomes an instant change, except the skeleton (static grey, no shimmer).
- No bouncing logos, spinning loaders on full pages, auto-playing carousels or confetti. The bolt flash is our one flourish.

| ID | Name | What happens | Timing | Where |
|---|---|---|---|---|
| M01 | Page enter | Main content fades in + rises 8px. Cards stagger 40ms (max 6, then all at once). | 200ms · ease-out | Every page load / route change |
| M02 | Route transition | Cross-fade between pages (View Transitions API). A job photo morphs from its tile into the job page header. | 180ms fade · 320ms morph | List → job page, board → job |
| M03 | Hover lift | Card rises 2px, shadow deepens to 0 10 24 / 18%. Photo inside zooms 1.04 (400ms). | 160ms · ease-out | Job tiles, category tiles, job rows, cards that link |
| M04 | Button press | Scale to .98 on press. Hover: brightness 1.06 (primary), tint fill (secondary), lift 1px + shadow (hero). | 120ms | All buttons |
| M05 | Focus ring | No animation. 2px #2163C6 ring, 2px offset, appears instantly. | 0ms | Anything focusable |
| M06 | Hero bolt parallax + nav fill | Bolt in the Forest band moves at 0.3× scroll (max 60px). Transparent site nav turns solid Forest with shadow after the hero. | Scroll-linked · nav 200ms | Landing, For tradies, service pages |
| M07 | Headline reveal | Hero headline lines rise 16px + fade, 70ms apart. Then sub-copy, then search bar. Runs once per visit. | 500ms · ease-out | Landing, For tradies hero |
| M08 | Search suggestions | Dropdown fades in and scales .98→1 from the top edge. Results update as you type (debounce 150ms). | 160ms | Hero search, header search, address field |
| M09 | Price reveal | Forest price block wipes in left→right (300ms), the number counts up from $0 (700ms, ease-out), then reassurance ticks appear one by one (60ms apart). Once per job. | ~1.1s total | Job · price ready (customer); You earn (tradie) |
| M10 | Bolt flash | Signature circle pops (0.6→1.08→1, spring), the tick/bolt draws in, 8 sparks burst out 26px and fade, and a soft signature glow pulses behind. The brand’s celebration. | 600ms | Posted, Paid, It’s yours, Sorted, Estimate sent. Big wins only. |
| M11 | Tracker progress | Line fills down to the next step (400ms), then the new dot pops (200ms) and its label fades in. | 600ms | Job trackers when status changes |
| M12 | Drawer | Slides in from the right, scrim fades to 50%. Out: 200ms. Focus moves to the drawer title. | 320ms in · 200ms out | Estimate, extra work, filters on narrow screens |
| M13 | Dialog | Fades in and scales .96→1 from slightly below centre; scrim fades. Out: 150ms. | 200ms | Confirms, sign-up gate, decline, claim |
| M14 | Toast | Rises 12px + fades in at bottom right; a signature hairline shrinks to show time left (4s). Pauses on hover/focus. | 200ms in · 4s · 200ms out | Saved, sent, copied, undo |
| M15 | Skeleton → content | Skeletons shimmer (1.2s loop) after a 300ms delay; real content cross-fades in. | 150ms cross-fade | Any data list or card |
| M16 | Tab underline | Active indicator slides and resizes to the new tab. | 200ms · ease-in-out | App nav, tabs, segmented controls |
| M17 | Number ticker | KPIs and money count up from 0 the first time they enter view. | 600ms · ease-out | Earnings, office KPIs, landing stats |
| M18 | Upload | Thumbnail appears (scale .9→1), progress ring fills, a tick pops when done. Failed: red ring + Retry. | 200ms + upload time | Photo and document uploads |
| M19 | Live message | New bubble rises 8px + fades. Typing indicator: 3 dots bounce. Thread auto-scrolls only if already at the bottom. | 160ms | Messages |
| M20 | Badge pop | Count badge pops (0→1.15→1) when the number goes up. No animation when it goes down. | 240ms | Nav badges, bell |
| M21 | Map pins | Pins drop in 12px + fade, staggered 30ms. Hovering a list row grows its pin 1.15× in the action colour, and vice versa. | 200ms | Tradie map view |
| M22 | Claim lost | Card desaturates to grey (200ms) and a banner slides down: “Too slow. Someone else got this one.” No shaking. | 200ms | Claim race |
| M23 | Save | Bookmark fills and pops 1.2× once. | 160ms | Save job |
| M24 | Accordion | Height animates to content; chevron rotates 180°. | 200ms | FAQ, help, filters |
| M25 | Status change | Pill colour cross-fades and pulses once (scale 1.05). | 200ms | Status pills when a job moves on |
| M26 | Drop zone | Dashed border turns solid action colour and the tint fills while a file is dragged over. | 120ms | Photo/document upload areas |
| M27 | Bounty shimmer + countdown | Gold bounty pins and cards glint every 4s (brightness + soft gold glow). Countdown rings tick down; under 2h the ring pulses gently. It should feel like a game. | 300ms every 4s | Quote bounties: map pins, cards, pings, quoter dashboard |

## Designed pages

### Home / landing — `/` (customer)
1. Transparent site nav over the hero. After scrolling past the hero it turns solid Forest with a shadow (M06). “For tradies” in Amber.
2. Hero: 92px Display headline (M07 reveal), one search bar = the main action. Typing + Enter or “Get a price” opens Post a job with the text filled in. Location defaults from the browser (ask once) or IP; editable.
3. Example chips pre-fill the search. Trust row: three facts, no numbers we can’t back up yet.
4. Floating “price ready” card shows the product in one glance. Slight 2° tilt, floats 6px up/down slowly (3s loop, off with reduced motion).
5. How it works: 3 cards, lift on hover (M03). Copy never mentions estimates.
6. Categories: the main trades + “Other”, which means any kind of labour (moving, cleaning, gardening, handyman, assembly, rubbish…). Every tile starts Post a job with that type picked.
7. Why us: 3 promises + photo collage (photos zoom on hover, M03).
8. Reviews: real reviews only, pulled from the database once we have them. Until then, hide this section.
9. For tradies band in trade colours (Amber bolt) → /for-tradies.
10. FAQ accordion (M24) + repeat of the search box before the footer. Footer: 4 link columns, NZBN, socials.
- Motion: M06 (Hero bolt parallax + nav fill), M07 (Headline reveal), M08 (Search suggestions), M03 (Hover lift), M24 (Accordion), M01 (Page enter) · Inventory: A01

### How it works — `/how-it-works` (customer)
1. Short Forest header (no search). Same site nav (active page underlined).
2. Each step: giant outlined number, short copy, a mini piece of real UI on the right. Rows rise in as they scroll into view (M01, once).
3. Customer-facing: no estimates, margins or pricing maths. Link to Help for the curious.
4. Ends with the same CTA band as the landing (not shown).
- Motion: M01 (Page enter), M03 (Hover lift) · Inventory: A02

### For tradies — `/for-tradies` (trade)
1. Whole page in trade mode: Hi-Vis/Amber accents, Amber bolt. Hero CTA “Join as a tradie” → /signup/tradie.
2. Right side: floating job cards showing “You earn” + an “It’s yours” toast. Cards float gently (3s loop); headline reveals with M07.
3. Four reasons in plain tradie talk. Icons in trade tint.
4. Requirements box: the honest list. Licensed trades need their licence; “Other” work (any labour) needs ID only. Pull from the trade config.
5. Below (not shown): earnings example, FAQ for tradies, testimonials from tradies once real, final CTA, footer.
- Motion: M07 (Headline reveal), M06 (Hero bolt parallax + nav fill), M03 (Hover lift) · Inventory: A03

### Service page (template) — `/services/electrical` (customer)
1. One template for every trade, including /services/other (“Anything else”: moving, cleaning, gardening, assembly…), and later trade × city (A05). Content from the trade config + CMS.
2. Crumbs + H1 with trade and city for SEO. Same hero search, type pre-set to the trade.
3. Popular jobs grid: each tile starts Post a job with that job pre-filled.
4. If the trade isn’t live yet: hero says “Coming soon” and the search becomes a waitlist form (A07).
- Motion: M03 (Hover lift), M08 (Search suggestions) · Inventory: A04, A05

### Trust & safety — `/trust` (customer)
1. Plain-language trust page. Every claim must be true on launch day (check with Matt).
2. Bolt-flash illustration (M10 plays once on load).
3. Six promises as cards. Link each to its help article.
- Motion: M10 (Bolt flash), M01 (Page enter) · Inventory: A06

### Not in your area yet — `/coming-soon` (customer)
1. Shown when an entered address is outside coverage (on landing, post a job step 3, or a service page). Never let them post a job we can’t do.
2. Suburb comes from the address they typed. Email + suburb saved to a waitlist table.
3. Success replaces nothing: a success banner appears under the form (M01) with a share link.
4. List of live areas from coverage settings (F14).
- Motion: M01 (Page enter), M14 (Toast) · Inventory: A07

### About & contact — `/about · /contact` (customer)
1. About and Contact can be separate pages; same layout pattern. Real founder photos replace initials.
2. Contact form: topic select routes to the office support inbox (F13). Sending / sent / error states.
3. Signed-in users get pointed to their job thread so context isn’t lost.
- Motion: M01 (Page enter) · Inventory: A08, A09

### Help centre + article — `/help · /help/[slug]` (customer)
1. Help home (not shown) = big search + topic cards (Customers, Tradies, Payments, Account) + popular articles.
2. Article layout: left topic nav, readable column (max 680px, 17px/1.65), right “Still stuck?” + related.
3. Search suggests articles as you type (M08). No results → “Message us”.
4. “Was this helpful?” records a vote; No opens a one-line “What were you looking for?”.
5. This is where pricing is explained to the curious (“How is my price worked out?”), never in the main flow.
- Motion: M08 (Search suggestions), M24 (Accordion) · Inventory: A10, A11, E08

### Legal pages + cookie banner — `/legal/*` (customer)
1. One template for Terms, Tradie terms, Privacy, Cookies. Sticky contents on the left highlights the section in view.
2. “Short version” banner at the top of each, in plain English. Lawyer-approved text below.
3. Cookie banner: bottom-left card on first visit (rises in, M14). “Only essential” is as easy as “Accept all”. Settings opens a dialog with toggles.
4. Last-updated date + PDF download. Footer links to all legal pages.
- Motion: M14 (Toast), M13 (Dialog) · Inventory: A13, A14, A15, A16

### Public tradie profile — `/tradies/[id]` (customer)
1. First name + initial publicly. No phone, email or exact location.
2. Badges must match what the office actually checked, per trade.
3. Reviews newest first, 10 per page. Paused or removed tradies → 404.
- Motion: M01 (Page enter) · Inventory: A12

### Log in — `/login` (customer)
1. Split layout ≥1024: Forest brand panel (bolt, illustration, line) left; form centred in the right half, max 440px. Under 1024: the mobile log-in screen.
2. Underline fields (original style). Error shown under the fields after submit, keeps the email, clears the password. After 5 tries: “Too many tries. Wait 10 minutes or reset your password.”
3. “Keep me logged in” = 30-day session, else browser session.
4. Log in button shown in its hover state (brightness 1.06, M04). Enter submits.
5. After log-in: back to the page they came from (?next=), else their home. Mode set from role.
- Motion: M04 (Button press), M01 (Page enter) · Inventory: B01

### Sign up · choose + details — `/signup` (customer)
1. Desktop puts the role choice and the details on one screen. Choosing “I’m a tradie” swaps the right side to the tradie form and the page to trade colours (cross-fade 200ms).
2. Choice cards: hover = light fill (shown on the tradie card). Selected = action border + tint.
3. Password strength bar (4 segments) + plain hint. No rules list unless they fail one.
4. Email already used → inline error with “Log in instead?” link.
5. On success → Verify email (B05). If they came from “Post it”, the job posts right after verifying.
- Motion: M04 (Button press), M01 (Page enter) · Inventory: B02, B03

### Sign up · tradie details — `/signup/tradie` (trade)
1. Trade mode: Hi-Vis buttons, Amber signature, #9E4A00 links, Amber bolt on the left.
2. One licence field appears per licensed trade picked (label + format from trade config). “Other / general labour” needs no licence: we check photo ID instead.
3. Area: suburb autocomplete + radius (10/25/50 km).
4. Honest about verification: can browse now, claim after checking.
5. Next: Verify email → Setup checklist (D01).
- Motion: M01 (Page enter) · Inventory: B04

### Verify email · reset password — `/verify · /recovery` (customer)
1. Left: verify-email holding page. Resend button disabled with a live countdown (60s). Once verified (link clicked in any tab), this page moves on by itself (poll every 5s).
2. Right: reset password (from /recovery link). Two fields, match check on blur.
3. Expired/invalid link state shown as a banner with a one-tap fix.
4. Both pages are simple centred cards on white with no app nav (the user isn’t fully in yet).
- Motion: M01 (Page enter) · Inventory: B05, B06

### Dialogs — `(dialogs)` (customer)
1. Decline price (C09): reasons optional, primary is the decline itself. “Saying no is free.”
2. Cancel job (C17): before payment = simple confirm, free. After payment = request with reason (Danger button), office reviews.
3. Session expired (B07): dialog over the page; logging in returns to the same page; drafts kept.
4. All dialogs: 16px radius, scrim 50%, M13 animation, focus trapped, Esc closes (except session expired), focus returns to the trigger. Max one dialog at a time.
- Motion: M13 (Dialog) · Inventory: B07, C09, C17

### Customer home — `/ (signed in)` (customer)
1. App nav (Forest, 68px): Home · My jobs · Messages, search (press / to focus), “Post a job” button, bell, avatar menu. Active tab has a Lime bar that slides (M16).
2. Greeting + one big “What needs doing?” box. Enter → Post a job with text.
3. Category tiles straddle the band edge (brand device). Hover lift (M03).
4. “Needs you” = only jobs waiting on the customer (price ready, please check, extra work). Card shown in hover state. Hidden when empty.
5. “In progress” = everything else active. New users see an empty state with the 3 steps instead.
6. Right column: popular job chips (pre-fill search) and a trust card.
- Motion: M16 (Tab underline), M03 (Hover lift), M01 (Page enter), M15 (Skeleton → content) · Inventory: C01

### Post a job · describe — `/jobs/new` (customer)
1. Full-page wizard, focused: slim nav with “Draft saved” + Save & exit. No main nav while posting.
2. Steps rail: done = action tick, now = tint. Clicking a done step jumps back.
3. Type guessed from the words typed (simple keyword match), always editable. Main trades + Other: Other covers any labour, and “not sure” goes there too (the office re-types it if needed).
4. Live summary on the right fills in as they go. Free-to-post reassurance.
5. Draft autosaves (sessionStorage now, server draft when signed in).
- Motion: M01 (Page enter), M11 (Tracker progress) · Inventory: C02

### Post a job · photos — `/jobs/new?step=photos` (customer)
1. Drop zone shown in its drag-over state (M26): solid action border + tint.
2. Each photo uploads straight away: progress ring (M18), × to remove (with Undo toast), failed = red outline + Retry.
3. Photos can be reordered by drag; the first is the cover.
4. Next waits for uploads to finish (button shows “Uploading 1…”).
- Motion: M26 (Drop zone), M18 (Upload), M14 (Toast) · Inventory: C03

### Post a job · where & when (time windows) — `/jobs/new?step=where` (customer)
1. Customers give time windows instead of messaging back and forth (decision: avoid direct messages where possible).
2. Grid of the next 7 days × morning / afternoon / evening. Tap to toggle; “Any time” fills all; “ASAP” flags urgency (raises the job in tradie pings).
3. Tradies then book one window (phone screen “Pick a time”). Customers can change windows from the job page until booked.
4. Address autocomplete is limited to the coverage area (Invercargill at launch); outside → waitlist page.
- Motion: M01 (Page enter), M04 (Button press) · Inventory: C04

### Post a job · check & post (+ sign-up gate) — `/jobs/new?step=review` (customer)
1. Review: every section with Edit (jumps to that step, keeps everything).
2. “Post it” is the hero CTA (signature colour, Display type). Shown in hover state: lifts 1px + shadow (M04).
3. Signed out? “Post it” opens the sign-up dialog (same fields as B03, plus “Log in instead”). After sign-up + verify, the job posts automatically.
4. Posting: button spinner, page locked. Error: banner at top, nothing lost.
- Motion: M04 (Button press), M13 (Dialog) · Inventory: C04, C05

### Posted (success) — `/jobs/[id]?posted=1` (customer)
1. The bolt flash (M10): circle pops, tick draws, sparks burst, glow pulses. Once only.
2. “Posted.” in Display. Then the tracker (step 2 is “now”).
3. Ask for browser notification permission here, once, with our own card first (never the raw browser prompt on page load).
4. Also sends a confirmation email (G05).
- Motion: M10 (Bolt flash), M11 (Tracker progress) · Inventory: C06

### Job · getting your price — `/jobs/[id] · REVIEW` (customer)
1. Desktop job page: left = gallery (click opens full-screen viewer, arrow keys), job details, info cards. Right = sticky status card (420px).
2. Status card: pill, one line of what’s happening, actions, tracker. Same card in every state; only its middle changes.
3. Editing is allowed until priced. Cancel is free here (simple confirm).
4. Gallery photo zooms slightly on hover (M03).
- Motion: M02 (Route transition), M03 (Hover lift), M25 (Status change) · Inventory: C07

### Job · needs a $30 quick look — `/jobs/[id] · QUOTE_BOUNTY` (customer)
1. Shown when the Trade Marketplace AI can’t settle a price from the photos and estimates. New status needed in the code (QUOTE_BOUNTY).
2. Plain words, no machinery: “hard to price from photos… pop round… one fixed price”.
3. Customer picks times that suit; the tradie books one of them (tradie map, site visit job).
4. Decided: $30, paid by the customer, comes off the final price if they go ahead. On the tradie side it appears as a gold quote bounty for 24h.
5. After the visit the flow carries on as normal: price ready → accept & pay → sorted.
- Motion: M25 (Status change), M11 (Tracker progress) · Inventory: C22

### Job · price ready — `/jobs/[id] · PRICED` (customer)
1. The most important screen. Price reveal (M09): Forest block wipes in, $0 → $372.00 counts up, Lime underline draws, ticks appear one by one. Once per job.
2. Price is 52px Display, tabular numbers, “incl. GST” always.
3. 3 reassurance ticks (wording per trade).
4. Hero “Accept & pay” → Checkout. “No thanks” → decline dialog (C09).
5. Also announced: email + push “Your price for Sub wiring is ready.”
- Motion: M09 (Price reveal), M04 (Button press) · Inventory: C08

### Checkout — `/pay/[paymentId]` (customer)
1. Focused checkout: slim nav, no distractions. TEST banner until real payments are switched on by both founders.
2. Card fields are the payment provider’s hosted fields (Stripe/Windcave), styled with our field tokens. Apple Pay / Google Pay buttons where supported.
3. Order summary sticky on the right. Pay button repeats the total.
4. States: processing (button spinner, page locked), 3-D Secure (provider dialog), declined (alert banner at top, keep method).
- Motion: M04 (Button press) · Inventory: C10

### Payment success — `/pay/[id]/done` (customer)
1. Bolt flash (M10) + plain message. Receipt also emailed (toast confirms, M14).
2. If payment fails we never show this page: back to checkout with the error.
3. Job page now shows “Booked · finding someone local”.
- Motion: M10 (Bolt flash), M14 (Toast) · Inventory: C11

### Job · tradie confirmed — `/jobs/[id] · ASSIGNED` (customer)
1. Tradie card links to their public profile. “Licensed electrician” only when checked for that trade.
2. Messages preview inline on the job page (latest 3). Full thread in Messages.
3. Tracker collapses to 3 steps once paid. Status pill change animates (M25), tracker fills (M11).
4. ⋯ menu (top of card, not shown): Request to cancel, Report a problem, Download receipt.
- Motion: M25 (Status change), M11 (Tracker progress), M19 (Live message) · Inventory: C12

### Extra work approval — `/jobs/[id] · variation` (customer)
1. Opens automatically when they land on the job (from email/push) and from the “Needs your OK” card.
2. Photos are required from the tradie; click to enlarge.
3. Approve → same checkout for the extra amount. Decline → small confirm, tradie notified.
4. Dialog M13. Focus starts on the heading, not the Approve button (no accidental Enter).
- Motion: M13 (Dialog) · Inventory: C13

### Please check + review — `/jobs/[id] · SUBMITTED` (customer)
1. Evidence first: CoC (electrical) or photos (other trades). View opens the PDF in a new tab.
2. Rating inline: stars (signature colour) + quick tags; a comment box appears after choosing stars.
3. “Yes, all sorted” → bolt flash “Sorted.” + review saved. “Something’s not right” → report form (C16), pauses auto-release.
4. Countdown is real: show “46h left” when under 48h.
- Motion: M10 (Bolt flash), M23 (Save) · Inventory: C14, C15, C16

### My jobs — `/dashboard` (customer)
1. Desktop = table; mobile = cards. Rows sorted: needs you first, then newest.
2. Tabs Active / Done / Cancelled (M16) + search (title, job number).
3. Row hover tint (shown on row 1). Whole row clicks through; the button is the main next step.
4. Empty states per tab (e.g. Done: “Nothing finished yet.”).
- Motion: M16 (Tab underline), M15 (Skeleton → content), M01 (Page enter) · Inventory: C18

### Payments & invoice — `/profile/payments · /receipts/[jobId]` (customer)
1. Payments list (Account → Payments): every payment and refund. Selected row shows its invoice on the right (desktop); separate page on mobile.
2. GST-compliant tax invoice: our GST number, date, description, GST amount.
3. Print uses a print stylesheet: white background, no nav, A4. PDF download matches.
4. Refunds: negative amount + Refunded pill.
- Motion: M01 (Page enter) · Inventory: C19, C20, G09

### Tradie home · setup checklist — `/jobs (first visit)` (trade)
1. First visits land here until setup is complete; then /jobs becomes the job board. A slim “Finish setup (4/6)” banner stays on the board until done.
2. Progress bar + checklist. Done items struck through; “Checking” pill while the office verifies.
3. Each “Add” opens the relevant settings page and returns here.
4. Right: honest “while you wait” (estimates allowed before verification) + 4-step explainer.
- Motion: M11 (Tracker progress), M03 (Hover lift), M01 (Page enter) · Inventory: D01

### Job board · list — `/jobs` (trade)
1. App nav in trade mode: “Tradie” flag, Find work · My work · Earnings · Messages. Amber active bar.
2. Filters sidebar (240px). Trades not verified are shown but disabled with the reason. Filters live in the URL.
3. Grid/Map toggle (segmented, M16). Sort: Nearest, Newest, Highest pay.
4. Photo tiles keep the source look; Amber tag shows what they earn; white “Needs estimate” tag otherwise. Hover lift + photo zoom (M03), saved = filled bookmark (M23).
5. Pagination: infinite scroll with skeleton tiles (M15). New jobs while browsing: “3 new jobs” pill at the top, click to load.
- Motion: M03 (Hover lift), M15 (Skeleton → content), M16 (Tab underline), M23 (Save) · Inventory: D02

### Job board · map (desktop) — `/jobs?view=map` (trade)
1. Uber-style map of every job near you, three kinds: Forest “$259” = ready to claim (what you earn); white “Estimate” + camera = quote from photos; GOLD “$30 · 17h” = quote bounty (go and quote in person).
2. Quick filter chips with live counts. The Bounty chip is gold too. Same filters as the grid; state in the URL.
3. Hover a row → its pin grows with a signature ring (and the reverse). Click a pin → preview card; click card → job page (M21).
4. Legend card bottom-left so the pin types are obvious on first use. Dismissible; remembered per user.
5. Bounty card: gold outline, countdown ring (bounties expire 24h after they’re created), $30 for an in-person quote, “Claim bounty”. Gold pins shimmer every few seconds (M27): it should feel like a game.
6. “Other” jobs (any labour) appear like any other trade, labelled Other. Anyone can take Other jobs.
- Motion: M21 (Map pins), M27 (Bounty shimmer + countdown), M16 (Tab underline) · Inventory: D03, D19

### Map · nearby jobs — `/jobs?view=map (phone)` (trade)
1. Full-screen map, like Uber. Blue dot = you. Pins: Forest “$259” = ready to claim (what you earn); white + camera = quote from photos; GOLD “$30 · 17h” = quote bounty.
2. Gold = easy money. Bounties shimmer (M27), sort first in the sheet, and have their own chip. It should feel like a game.
3. “You’re available” switch: on = pinged about new jobs and bounties nearby. Off = browse quietly.
4. Bottom sheet peeks with swipeable job cards. Swiping centres the pin; tapping a pin scrolls to its card (M21). Drag up for the full list.
- Motion: M21 (Map pins), M14 (Toast) · Inventory: 

### Quote bounty (sheet up) — `/jobs/[id] · QUOTE_BOUNTY` (trade)
1. Triggered when the Trade Marketplace AI can’t settle a price from the photos and estimates: a $30 bounty appears on the map for 24h.
2. Anyone good can claim it; one person at a time. After claiming, pick one of the customer’s windows to visit (no messaging needed).
3. After the visit, send a fixed price. The AI checks it against the other estimates and its own prediction.
4. If the price is accepted and fair, the quoter gets first dibs on the job. Way off (e.g. $1,200 on a $300 job): it’s ignored and the job opens to everyone.
5. Countdown ring shrinks to 0 (M27). Expired → the office decides.
- Motion: M21 (Map pins), M14 (Toast) · Inventory: 

### Book a time window — `/jobs/[id]/book` (trade)
1. Replaces direct messages for booking. The customer sets windows when posting; the tradie picks one.
2. Preset updates instead of chat: “I’m on my way”, “Running late (15/30/60 min)”, “Need to reschedule” (→ pick a new window).
3. Messages still exist for problems, routed through Trade Marketplace if needed. Keep them out of the happy path.
4. Customer sees: “Jack’s booked in Thu 8–10am” + add to calendar.
- Motion: M21 (Map pins), M14 (Toast) · Inventory: 

### Crew invite — `(push + in-app)` (trade)
1. Team jobs: the lead claims the job, then invites people from their crew (or any worker) with a set split.
2. The invite shows the job, their part, when, and their share in dollars and %. Accept or decline.
3. Each crew member is paid their share directly through payroll. The lead is responsible for the job, the customer and the evidence.
4. The customer only ever sees the lead. Nothing changes for them.
- Motion: M21 (Map pins), M14 (Toast) · Inventory: 

### New job ping (available) — `(in-app + push)` (trade)
1. When “available” is on, new jobs and bounties near you pop in as a card (M14/M20) and as a push when the app is closed.
2. Shows what you earn, how far and the time left. Bounty pings are gold.
3. Skip hides it from your pings (not from the map). One ping at a time; quiet hours default 9pm–7am.
- Motion: M21 (Map pins), M14 (Toast) · Inventory: 

### Job · estimate (drawer) — `/jobs/[id] · REVIEW` (trade)
1. Job page (trade): gallery, details, customer first name + suburb only. Right card: social proof + hero “Estimate now”.
2. Estimate opens in a right drawer (M12) so the photos stay visible behind. Esc closes; unsent values kept if reopened.
3. Private banner. Hours stepper (keyboard: arrows ±0.5), materials, note, site-visit tick.
4. Send → drawer closes → bolt flash “Sent.” toast-style (M10 small) and the card switches to “Your estimate: 3.5 h · $85 · Edit”.
5. Not eligible (wrong trade/unverified): hero replaced by a banner explaining why.
- Motion: M12 (Drawer), M10 (Bolt flash) · Inventory: D04, D05

### Job · claim (+ result) — `/jobs/[id] · BOOKABLE` (trade)
1. Claimable job: what you earn (M09 reveal, tradie version), budget, needs, timing. Never the customer price.
2. Claim → small confirm dialog first (“Take this job?” with the same numbers, Yes it’s mine / Not now). Shown here: the result.
3. Success dialog: bolt mark in a signature circle with sparks (M10), “It’s yours.”, three next steps, two actions.
4. Lost the race: the card greys out and a banner says “Too slow. Someone else got this one.” + “See similar jobs” (M22).
- Motion: M09 (Price reveal), M13 (Dialog), M10 (Bolt flash), M22 (Claim lost) · Inventory: D06, D07

### My work — `/dashboard` (trade)
1. Read-only board grouped by the tradie’s next move (no dragging; status comes from the server).
2. Card pills = the next action (“Message Sarah”), not database words. Click → job workspace.
3. Estimates tab: table of estimates with outcome (Priced · Taken by you · Not taken).
4. On mobile this becomes the segmented list from the first guide.
- Motion: M03 (Hover lift), M25 (Status change) · Inventory: D08, D13

### Job workspace (+ extra work drawer) — `/jobs/[id] · ASSIGNED (trade)` (trade)
1. Everything for the job on one screen: customer + map + call/directions, Telfer number (click to copy, tooltip “Copied”), live messages, tracker.
2. Two main actions top right: Extra work (opens drawer, D10) and Finish job (D11).
3. Messages live (M19): typing dots, new bubbles rise in. Photos can be sent.
4. Tracker shows what’s next, including the 48h sign-off window.
5. Extra work drawer (not shown): same pattern as the estimate drawer: what, required photos, hours, materials, Send for pricing. Status then shows on the tracker.
- Motion: M19 (Live message), M12 (Drawer), M11 (Tracker progress), M14 (Toast) · Inventory: D09, D10

### Lead adds a crew (team job) — `/jobs/[id] · ASSIGNED (lead)` (trade)
1. Team jobs (decision 6a): the lead claims the job and adds crew with a split they set. Shares must add to 100%; the lead’s share updates live.
2. “Your crew” = people you’ve worked with or added (like friends). You can also search any worker.
3. Invite → the crew member gets the “Join the crew” card (phone) and accepts or declines. Status shows Invited / Joined / Declined.
4. The customer only sees the lead. Payroll pays each person their share.
5. Later (P3): “Need a hand?” lets a solo lead request a specialist (e.g. a plumber on a bathroom reno) without making a new job.
- Motion: M12 (Drawer), M14 (Toast) · Inventory: D21, D23

### Finish job — `/jobs/[id]/complete` (trade)
1. Focused single-column form (max 760px). Evidence fields come from the trade’s config: electrical = CoC number + PDF/photo (required, existing server rule).
2. Uploads follow M18; a green tick confirms each file.
3. Declaration tick required. “Save for later” keeps a draft.
4. Send → bolt flash “Sent for sign-off” + tracker moves (M11).
- Motion: M18 (Upload), M10 (Bolt flash), M11 (Tracker progress) · Inventory: D11

### Earnings — `/earnings` (trade)
1. KPIs count up on first view (M17). Wording is exact: Queued vs Paid. Never say money moved before payroll runs.
2. Simple 8-week bar chart (current week in Hi-Vis). Hover a bar → tooltip with the amount.
3. Payroll table → click a row for the per-job breakdown (hours, rate, holiday pay).
4. Statement download = PDF for their records/tax.
- Motion: M17 (Number ticker), M01 (Page enter) · Inventory: D12

### Verified quoter dashboard — `/quoting` (trade)
1. Verified quoter: invite only, with tougher screening (decision 7). Someone who knows the trades can earn without picking up tools.
2. Scorecard: accuracy, bounties, 2% earnings, weekly bonus progress (KPIs tick up, M17).
3. History shows each quote vs the final price and the outcome. Way-off quotes are marked “Ignored · unfair”.
4. The earning rules are spelt out. The 2% only counts when the price is accepted, fair and the job finishes clean, so quoting high never pays.
5. Exact thresholds (what counts as “fair”, bonus size) live in office Settings and can change.
- Motion: M17 (Number ticker), M27 (Bounty shimmer + countdown) · Inventory: D25

### Account · trades & licences + bank — `/profile/trades` (trade)
1. Account settings layout: left nav (240px), content max 760. Same pattern for every settings page.
2. One row per trade with its own status: Checked (expiry shown) · Checking · Rejected (with the reason + Try again).
3. Expiring within 30 days: Amber banner + email reminder.
4. Bank & IRD masked after saving; editing asks for the password again. Missing bank details block payouts (banner on Earnings).
- Motion: M01 (Page enter), M25 (Status change) · Inventory: D14, D15, D16, D17

### Messages — `/messages/[jobId]` (customer)
1. Three panes ≥1200px: threads · conversation · job context. 1024–1199: context pane hides behind an (i) button. Mobile: one pane at a time.
2. One thread per job. Office messages show as “Trade Marketplace” with the bolt avatar.
3. Job events appear as action cards inside the thread (extra work, finished, paid).
4. Typing indicator + new bubbles animate (M19). Read receipts on the last message only.
5. Enter sends, Shift+Enter new line. Photos by drag-and-drop or the photo button. Unsent text kept per thread.
- Motion: M19 (Live message), M20 (Badge pop) · Inventory: E01

### Notifications dropdown + avatar menu — `(header)` (customer)
1. Bell → dropdown panel (400px), latest 8, unread tinted with a red dot. Opens with M08; badge pops when the count goes up (M20).
2. Each row deep-links to the exact job/thread/receipt and marks itself read.
3. Avatar → menu: Account, Payments, Notification settings, Help, Log out (Danger). Shown in a separate spot here so both are visible.
4. Tooltips on icon-only buttons after 500ms hover (shown on search). Tooltips also show keyboard shortcuts.
- Motion: M08 (Search suggestions), M20 (Badge pop) · Inventory: E02, E03, E09

### Account settings — `/profile/notifications` (customer)
1. Settings layout shared by every account page: left nav (240), content max 820. Pages: Profile, Security (email, password, log out other devices), Notifications, Addresses, Payments, Delete account.
2. Notification matrix: event × channel. Must-have messages are locked on (dimmed tick + reason).
3. Toggles save straight away with an Undo toast (M14). Text-heavy forms (Profile) use an explicit Save button instead.
4. Delete account: explains what’s kept (invoices, by law), blocked while a job is active, type DELETE to confirm.
- Motion: M14 (Toast), M16 (Tab underline) · Inventory: E04, E05, E06, E07

### Office · queues — `/admin` (office)
1. Office mode: Forest sidebar with Mint, counts per section. Desktop-first; usable on a tablet; on a phone tables become cards.
2. KPI cards = queues; red top edge + red text when anything is overdue (e.g. > 24h). Click a card = open that tab. Numbers tick up on load (M17).
3. Each queue is a table, oldest/most urgent first, one action per row. Row hover tint.
4. Global search (/): job number, customer, tradie, email, phone.
- Motion: M17 (Number ticker), M16 (Tab underline), M03 (Hover lift) · Inventory: F01

### Office · price a job — `/admin/jobs/[id]/price` (office)
1. Pricing workspace: job + photos, blind estimates with each tradie’s track record, suggested trimmed average.
2. Price builder: office enters hours/materials; the server returns the breakdown (customer pays, tradie earns, budget). UI never calculates.
3. “Send price to customer” → confirm dialog showing exactly what the customer will see → queue count drops (M17).
4. “Needs a site visit” sends the customer a message + books a paid visit (future).
5. Price extra work (F03) uses the same layout with the tradie’s photos and request.
- Motion: M13 (Dialog), M17 (Number ticker) · Inventory: F02, F03

### Office · AI pricing review — `/admin/pricing` (office)
1. The Trade Marketplace AI prices most jobs on its own (“Auto-priced today”). Only unsure ones reach a human.
2. Each row shows the AI price, its confidence, the spread of estimates, any in-person bounty quote, and why it’s here.
3. The trigger rule is written down and editable in Settings (confidence and spread thresholds).
4. Detail panel: everything side by side, a suggested price, one-click send. Who gets first dibs is shown so the office can overrule it.
5. Expired bounties with no quote land here too (repost, raise the bounty, or price by hand).
- Motion: M17 (Number ticker), M13 (Dialog) · Inventory: F15

### Office · all jobs — `/admin/jobs` (office)
1. Every job, filterable (status, trade, region, date) and searchable. Filters are chips with dropdowns; state in the URL.
2. Office status labels (not customer words). Selected row tint shows the one open in the detail view.
3. Pagination 25 per page. Export CSV respects filters.
4. Click → Job admin view (F05).
- Motion: M15 (Skeleton → content) · Inventory: F04

### Office · job admin view — `/admin/jobs/[id]` (office)
1. Everything about one job: money, messages (office can message both sides), full timeline (audit log: who did what, when).
2. Actions menu: reassign, refund, edit price, cancel. Each opens a confirm dialog with a required note (stored in the timeline).
3. Refund dialog asks full/partial + reason; shows it’s a record until real payments are on.
4. Timeline newest first; colour dots by actor (customer, tradie, office, system).
- Motion: M13 (Dialog), M01 (Page enter) · Inventory: F05, F06, F07, F11

### Office · tradies — `/admin/tradies` (office)
1. Per-trade checks: each trade a person claims is reviewed separately, with its own register link.
2. Decision needs a note; rejection needs a reason the tradie will see. Both go to the audit timeline.
3. Verified tab: search, expiry dates (sort by expiring soon), pause/un-pause with reason.
4. Customers (F09) uses the same table + detail-panel pattern.
- Motion: M13 (Dialog), M14 (Toast) · Inventory: F08, F09, F12

### Office · payouts — `/admin/payouts` (office)
1. Existing payroll export + reconciliation, restyled. Honest banner: records, not transfers.
2. KPIs for the current batch + blockers (missing bank details).
3. “Mark batch paid” → confirm dialog naming the total and count.
- Motion: M17 (Number ticker), M13 (Dialog) · Inventory: F10

### Office · settings — `/admin/settings` (office)
1. Tabs: Rates (per trade), Trades (switch trades on/off, licence + evidence rules), Coverage (live suburbs → waitlist), Emails (edit templates), Team (office users, roles).
2. Per-trade rate cards (new: today there’s one shared rate). Live example price from the server.
3. Save shows a confirm listing what changed; changes logged with who/when.
4. Figures are placeholders: use the real settings.
- Motion: M16 (Tab underline), M13 (Dialog) · Inventory: F14

### 404 · 500 · maintenance · offline — `(any)` (customer)
1. 404: Forest, big Lime “404”, plain words, Go home + Help. Also used for jobs you can’t see (never reveal they exist).
2. 500: our fault, say so. Show an error reference for support; log the details. Drafts are kept.
3. Maintenance: scheduled downtime page with the exact window. A banner warns 24h before.
4. Offline: persistent top banner, skeletons stay, actions queue or disable with a reason. Auto-retry with backoff.
- Motion: M15 (Skeleton → content), M01 (Page enter) · Inventory: G01, G02, G03, G04

### Emails & texts — `(email · SMS · push)` (customer)
1. One email template: Cream background, white card, Forest header with logo + small bolt, one heading, short body, one hero button, footer with settings link. Built as HTML email (table layout), with plain-text versions.
2. Customer emails use Lime buttons; tradie emails Amber. Same voice as the app. One job per email.
3. Full list to build: welcome, verify, password reset, price ready, receipt, tradie confirmed, new message (digest), extra work, please check, review request, cancellation outcome; tradie: new job near you, estimate request, claimed, sign-off, paid, licence checked/rejected/expiring.
4. Texts: under 160 characters, short link, sender “TradeMkt”. Push: same text, deep link.
5. Test in Gmail, Outlook, Apple Mail, light + dark mode.
- Motion: — · Inventory: G05, G06

### Icons, share images & install — `(meta)` (customer)
1. Favicon = bolt mark on Forest (SVG + 32px PNG), apple-touch-icon 180, PWA icons 192/512 with a maskable version.
2. Page titles follow one pattern; unread count shows in the tab title.
3. Install prompt: our own card, offered once at a good moment (never on first load).
4. Share images per page type, in both modes. Private pages (jobs, account, office) are noindex with no share image.
- Motion: — · Inventory: G07, G08

## Easy to forget

- **Analytics events:** post_started, job_posted, price_viewed, price_accepted, price_declined, paid, claimed, claim_lost, estimate_sent, variation_approved/declined, signed_off, review_posted. No personal data in events.
- **Error tracking & uptime:** Front-end errors reported with the error ref shown to users (500 page). Status page link in the footer.
- **SEO basics:** Titles + descriptions per public page, service/location pages indexable, app pages noindex, sitemap.xml, robots.txt, structured data (LocalBusiness, FAQ).
- **Browser support:** Last 2 versions of Chrome, Safari, Edge, Firefox; iOS Safari 16+; Android Chrome. No IE.
- **Performance:** LCP < 2.5s on 4G, CLS < 0.1, INP < 200ms. Images lazy + sized. Landing hero image preloaded.
- **Cookie consent:** Analytics only after consent (A16). Essential cookies only otherwise.
- **Keyboard shortcuts:** / search · Esc close · Enter submit · ←/→ gallery · ↑/↓ steppers. Shown in tooltips.
- **Print:** Receipts, invoices and office job pages print clean (no nav, white, A4).
- **Time & money:** Pacific/Auckland timezone, en-NZ formats, NZD, GST shown on every price.
- **Empty, loading, error:** Every list and page from the inventory has all three designed (skeletons, not spinners).

## A page is done when…

- [ ] Matches its mockup here at 1440 and its v1 mobile screen at 390
- [ ] Works at 320 / 390 / 768 / 1024 / 1440 with no sideways scroll
- [ ] Every state from the inventory is built (loading, empty, error, success)
- [ ] Hover, focus, pressed and disabled states as on the Effects page
- [ ] Motion uses the named animations; reduced motion turns them off
- [ ] Keyboard-only run-through works; axe shows no violations
- [ ] Copy matches the voice rules; numbers come from the server
- [ ] Tokens + kit components only: no hex, no one-off styles
- [ ] lint · typecheck · test · build all green; screenshots in the PR

## Decided (23 Oct 2026)

1. **Who can take jobs:** Anyone can take Other jobs and unrestricted work. Checks are loose at the start; checked workers get a verified badge. Restricted work (electrical, plumbing, gasfitting, drainlaying, restricted building work) still needs a licence on file before claiming.
2. **Quote bounties:** When the Trade Marketplace AI can’t settle a price from photos + estimates, a $30 quote bounty appears (gold on the map, 24h). Anyone good can claim it, visit in a customer window, and send a fixed price. The AI checks it against the estimates and its own prediction.
3. **Who pays the $30:** The customer books a $30 quick look; it comes off the final price if they go ahead.
4. **First dibs:** The quoter gets first dibs only if their price is accepted and the AI deems it fair. Way-off quotes are ignored and the job opens to everyone.
5. **Team jobs:** One lead per job. The lead sets each person’s split and invites crew (accept/decline). Everyone is paid their share through payroll. The customer only sees the lead. Later: request a specialist inside a job.
6. **Verified quoters:** Invite only, tougher screening. Earn $30 per quote + 2% of jobs where their price is accepted, fair and the job finishes without a dispute + a weekly bonus for accurate quotes.
7. **Payments:** Stripe, with Apple Pay. Real payments switch on last, after lots of testing.
8. **Map:** Mapbox for now.
9. **Rates:** One shared rate + an Other rate at launch; per-trade rates possible later (configurable in Settings).
10. **Scheduling:** Customers give time windows; workers book one. Preset updates (on my way, running late, reschedule) instead of chat where possible.
11. **Phone numbers:** Hidden until a job is claimed, then both sides can see them.
12. **Launch area:** Invercargill.

## Still to decide

- Email/SMS provider and sender names
- Legal check: restricted work rules + platform liability (lawyer)
- AI pricing thresholds and what counts as a “fair” quote
- What the 2% is a share of (labour, or the whole job?) and the weekly bonus amount
- What happens when a bounty expires or the customer says no to the $30 look
- Who builds the AI pricing model, and when