# Trade Marketplace — Front-End Build Guide (v1.0, October 2026)

Text version of the PDF guide, for developers and AI agents. Visual reference: `Trade Marketplace Front-End Build Guide.pdf` and `screens.html` (all 54 screens as live HTML). Tokens: `tokens.css`. Component CSS: `components.css`.

**Authority order:** 1) Brand Guidelines PDF → 2) this guide + kit → 3) original Figma `WurSo76mY67lO23D4Zlu7v` for 390px geometry of 2022 screens → 4) `BUSINESS_PLAN.md` for how a job works. If a screen and the business plan disagree, ask Matt. This guide supersedes older front-end docs in `/docs` (frontend-handoff.md, ui-layout-review.md, etc.).

All prices, names and numbers in mockups are examples, not pricing rules.

## 0. Six rules

1. **Tokens, never hex.** Every colour, size, radius and shadow comes from tokens.css. If a value is missing, add a token. Don’t type a hex code in a component.
2. **One attribute switches the mode.** <html data-mode="customer|trade|office">. Green for customers, orange for tradies, forest/mint for the office. Components never check the role themselves.
3. **Mobile first, 390 is the source.** Build at 390px to match the original Figma. Then widen to tablet and desktop using the layout rules. Never shrink the 390 design to fit 320. Let it reflow.
4. **Customers never see the machinery.** No estimates, averages or margins in customer screens. They see three things: post it, accept the price, someone local sorts it.
5. **The server owns the numbers.** Prices, earnings, GST and statuses come from the server. The UI shows them and never recalculates them.
6. **Every state, every time.** Each screen needs loading, empty, error and success states, plus a working keyboard and screen reader. A screen isn’t done until all of them are.

## 1. Modes

Set one attribute on `<html>` on the server: `data-mode="customer"` (CUSTOMER), `"trade"` (TRADIE), `"office"` (ADMIN). Components only use mode tokens (`--trade-action`, `--trade-on-action`, `--trade-signature`, `--trade-on-signature`, `--trade-link`, `--trade-tint`).

| Token | Customer | Trade | Office |
|---|---|---|---|
| `--trade-action` | #6CBD45 Leaf | #FF8200 Hi-Vis | #0C251D Forest |
| `--trade-on-action` | #0C251D | #0C251D | #FFFFFF |
| `--trade-signature` | #A6D754 Lime | #ECA154 Amber | #B7F0E4 Mint |
| `--trade-link` | #326C20 | #9E4A00 | #0C251D |

**Customers never see the machinery:** no estimates, averages, margins or “how pricing works” in customer flows. They see: post it → accept the price → someone local sorts it. The explanation lives in Help. **Tradies see what they earn**, never the customer price. **The server owns all numbers.**

## 2. Job states (one status, three labels)

| Server status | Customer pill | Tradie pill | Office queue |
|---|---|---|---|
| `REVIEW` | Getting your price (waiting) | Needs an estimate (action) | To price |
| `PRICED` | Price ready (action) | (hidden) (—) | Waiting on customer |
| `BOOKABLE` | Booked (good) | Ready to claim (action) | Unclaimed (alert > 48 h) |
| `ASSIGNED` | Tradie confirmed (good) | On now / Message customer (action) | In progress |
| `ASSIGNED + variation` | Needs your OK (action) | Waiting on approval (waiting) | Price extra work |
| `SUBMITTED` | Please check (action) | Waiting sign-off (waiting) | Sign-off (auto 48 h) |
| `COMPLETED` | Sorted (done) | Done · Queued / Paid (good) | Payroll |
| `CANCEL_REVIEW` | Cancel requested (alert) | On hold (alert) | Cancellation (alert) |
| `CANCELLED` | Cancelled (waiting) | (hidden) (—) | Closed |

Pill kinds: `waiting` (we’re on it), `action` (you need to act; signature colour), `good`, `done` (Forest), `alert`, `info`. Payments: Pending/Paid/Refunded. Variations: Requested → Priced → Approved/Declined. Payroll: Queued → Paid.

## 3. Sitemap

- **Public:** `/` landing · `/for-tradies` · `/login` · `/signup` (2–3 steps) · `/recovery` · `/support` · `/tradies/[id]` · `/terms`, `/privacy` (new)
- **Customer:** `/` home (signed in) · `/jobs/new` (4 steps) · `/jobs/[id]` (all states) · `/pay/[paymentId]` · `/dashboard` (My jobs) · `/receipts/[jobId]`
- **Tradie:** `/jobs` (job board) · `/jobs?view=all` · `/jobs/[id]` · `/jobs/[id]/estimate` (new) · `/jobs/[id]/variation` (new) · `/jobs/[id]/complete` (new) · `/dashboard` (My work) · `/earnings` (new)
- **Shared:** `/messages` · `/messages/[jobId]` (new) · `/notifications` · `/profile` · `/profile/details` (new) · `/profile/trades` (new, trade)
- **Office:** `/admin` queues · `/admin/jobs/[id]/price` (new) · `/admin/jobs` (new) · `/admin/tradies` · `/admin/payouts` · `/admin/settings`

Full-screen flows (post a job, estimate, extra work, finish job, pay) hide the bottom nav and use Close (×).

## 4. Navigation

Mobile: original 5-icon bottom bar, 64px + safe area, icons 26px, no visible labels (aria-label on each). Active = filled icon + 3px action-colour bar. ≥1024px: Forest top nav. Office: 240px Forest sidebar (Mint active), collapses under 1024.

| Mode | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| Customer | Home | Search | My jobs | Messages | Account |
| Tradie | Home (job board) | Search/all jobs | My work | Messages | Account + earnings |
| Office | Queues | All jobs | Tradies | Payouts | Settings |

Headers: Forest band (menu · search · action + white title, category tiles straddle the edge) on Home/Browse/Account/success screens; white 56px app bar elsewhere. Keep filters in the URL so Back works.

## 5. Foundations

See `tokens.css` for every value. Key points:

- **Type:** Roboto Flex self-hosted as `Trade Display` (wght 900, wdth 151, opsz 28; set `font-variation-settings` explicitly) and `Trade UI`. Never ship SF Pro on the web.
| Style | Size / line height | Font | Use |
|---|---|---|---|
| Display (`--trade-fs-display`) | 64px / 1.05 | Display 900/151 | Splash, landing hero (80 on desktop) |
| Title (`--trade-fs-title`) | 36px / 1.1 | Display 900/151 | Screen titles, auth |
| Price (`--trade-fs-price`) | 28px / 1.1 | Display 900/151 · tabular | Prices, earnings, KPIs |
| Heading (`--trade-fs-heading`) | 24px / 1.15 | Display 900/151 | Section headings, sheet titles |
| Subheading (`--trade-fs-subheading`) | 20px / 1.2 | Display 900/151 | Names, sub-sections |
| Section (`--trade-fs-section`) | 18px / 1.2 | Display 900/151 | Section labels |
| Label (`--trade-fs-label`) | 15px / 1.2 | Display 900/151 | Tile overlays, status |
| Body (`--trade-fs-body`) | 16px / 1.45 | UI 400 | Paragraphs, inputs (never < 16 on inputs) |
| Small (`--trade-fs-small`) | 14px / 1.4 | UI 400 / 700 | Meta, links, buttons |
| Caption (`--trade-fs-caption`) | 12px / 1.35 | UI 400 | Captions (web min 12) |

- **Space:** 4px scale. Source insets: lists 16px, auth/forms 36px (20 on long forms), category gap 12px, photo grid gap 6px.
- **Shape:** photo tiles 5px, buttons/cards 11px, sheets 22px top, pills 999px, fields 0px.
- **Elevation:** card `0 4px 4px rgb(0 0 0/25%)`, hero CTA 10%, header 5%, pop `0 12px 32px rgb(12 37 29/18%)`.
- **Sizes:** tap ≥44px, button 55, hero 61, field 48, nav 64+safe area, app bar 56, category tile 159×162, photo tile 187 high.
- **Breakpoints:** sm <600 (phone, 390 geometry, must reflow at 320) · md 600–1023 (2 cols, max 720) · lg ≥1024 (top nav, 12 col, max 1200) · xl ≥1440 (more margin only).
- **Icons:** Material Symbols Rounded (Apache 2.0), self-hosted, weight 400, opsz 24; filled for active/saved/status. Mapping:

| Use | Material | iOS SF Symbol |
|---|---|---|
| Home | `home` | house.fill |
| Search | `search` | magnifyingglass |
| Jobs | `wallet` | stacked card * |
| Messages | `chat_bubble` | bubble * |
| Account | `person` | person |
| Menu | `menu` | line.3.horizontal |
| Post a job | `add_box` | plus.square.fill |
| Save | `bookmark` | bookmark |
| Notifications | `notifications` | bell.fill |
| Back | `arrow_back` | chevron.left |
| Close | `close` | xmark |
| Filter | `tune` | slider.horizontal.3 |
| Sort | `swap_vert` | arrow.up.arrow.down |
| Estimate | `edit_square` | square.and.pencil |
| Add photo | `photo_camera` | camera |
| Location | `near_me` | location.circle |
| Email | `mail` | envelope |
| Password | `lock` | lock |
| Show password | `visibility` | eye |
| Valid | `check` | checkmark |
| Rating | `star` | star.fill |
| Verified | `verified` | checkmark.seal |
| Call | `call` | phone |
| Receipt | `receipt_long` | doc.text |
| Payments | `payments` | banknote |
| Help | `help` | questionmark.circle |
| Offline | `wifi_off` | wifi.slash |
| Share | `ios_share` | square.and.arrow.up |

- **Contrast (WCAG AA):**
  - #0C251D on #6CBD45: 6.94:1 (Leaf button label)
  - #0C251D on #FF8200: 6.51:1 (Hi-Vis button label)
  - #0C251D on #A6D754: 9.61:1 (Lime hero)
  - #0C251D on #ECA154: 7.54:1 (Amber hero)
  - #52645B on #FFFFFF: 6.30:1 (Secondary text)
  - #6B7A72 on #FFFFFF: 4.51:1 (Hints)
  - #326C20 on #FFFFFF: 6.36:1 (Customer link)
  - #9E4A00 on #FFFFFF: 6.12:1 (Trade link)
  - #A12424 on #FFFFFF: 7.52:1 (Danger)
  - #FFFFFF on #6CBD45: 2.33:1 (OLD white label — do not use)
  - #898989 on #FFFFFF: 3.50:1 (OLD grey text — decorative only)

## 6. Components (classes in components.css → React components)

- **Button** `tm-btn` + `--primary` (action fill, Forest label) · `--secondary` (white, 2px action stroke) · `--hero` (signature, Display 24, 61h, one per screen) · `--ghost` · `--danger` · `--small` · `--loading` (spinner) · disabled (`aria-disabled`, explain why nearby). Full width on mobile. Press scale .98.
- **Fields** underline `tm-input-line` (auth) and box `tm-input` (everything else). Label always visible, hint below, error below with icon (`tm-field__error`), 2px focus/error borders. Inputs 16px. Validate on blur + submit; focus first error; announce count.
- **Choice cards** `tm-choice` (radio/checkbox as rows; selected = 2px action border + tint) · **chips** `tm-chip` / `--on` · **photo upload** `tm-upload` (3 per row, 5px radius, ×, progress, retry) · **form progress** `tm-progress`.
- **Cards** `tm-card` · **category tile** `tm-cat` (159×162, 3D art on category tint) · **photo tile** `tm-tile` (gradient + Display text; trade tiles show “You earn $x”) · **job row** `tm-jobrow` · **price block** `tm-pricebox` (Forest + bolt) · **tradie card** (avatar, stars, `tm-verified`).
- **Status pill** `tm-status--waiting|action|good|done|alert|info` — one `<StatusPill status audience>` component with a label map (section 2).
- **Tracker** `tm-track` (done/now/todo) · **bubbles** `tm-bubble--them|me|system` · **composer** `tm-composer`.
- **Sheet** `tm-sheet` + `tm-scrim` (22px radius, grab handle, focus trap, Escape/swipe closes, focus returns) · **banner** `tm-banner--brand|info|good|alert|test` · **toast** `tm-toast` (4s, Undo, role=status) · **empty** `tm-empty` · **skeleton** `tm-skel` (after 300ms).
- **Shell** bottom nav `tm-nav`, app bar `tm-appbar`, Forest band `tm-band` + bolt `tm-bolt` (signature, 20% opacity, bleeds off an edge), top nav `tm-topnav`, tabs `tm-tabs`, segmented `tm-seg`.
- No emoji in UI. Card = one link (Save is the only nested button). Clamp tile text to 3 lines, row titles to 1. Missing photo = Forest placeholder with bolt.

## 7. Screens

### Public

#### Landing — `/`
1. One obvious action: “What needs doing?” Typing or tapping Get a price opens Post a job step 1 with the text carried over (no sign-up wall first).
2. Popular chips pre-fill the job text.
3. 3 steps only. Never explain estimates or how pricing works to customers.
4. Top-right Log in. A “For tradies” link sits in the footer and the menu (Hi-Vis).
5. Desktop version: see Desktop pages.

#### Log in — `/login`
1. Matches original Figma node 7:8 (390×844). Fields are underline style, border #52645B.
2. Email gets a valid tick (action colour) only after format check.
3. Errors: inline under the field + keep what was typed. Message: “That email and password don’t match.”
4. After log-in: set data-mode from role, then go to the user’s Home.
5. Mode-neutral (customer green) because we don’t know the role yet.

#### Sign up · who are you? — `/signup`
1. Step 1 of sign-up. One choice, then Next. Choosing “I’m a tradie” switches the rest of sign-up to trade mode (orange).
2. Selected choice card: 2px action border + tint fill. Whole card is the hit area (role="radio").
3. Existing /signup has these steps already; this is the target look.

#### Sign up · your details — `/signup?step=2`
1. Original “Create Account” layout. Field order: name, email, mobile, password.
2. Focused field: 2px focus-blue underline. Show/hide password toggle.
3. Region is NOT asked here for customers: we take the address when they post a job.
4. On success: customer lands on Home with a welcome toast “You’re in. What needs doing?”.

#### Sign up · tradie details — `/signup?step=trade` (mode: trade)
1. Trade mode from here on (Hi-Vis actions, Amber signature, #9E4A00 links).
2. Trade list comes from the CATEGORIES constant: main trades + Other (general labour). Licence field label + requiredness change per trade (EWRB for electrical); Other needs no licence, ID check instead.
3. Never imply a tradie is verified for a trade until the office checks it.

#### Forgot password — `/recovery`
1. States (already prototyped at /recovery): request → sent → expired → reset → complete.
2. Sent message never confirms whether an account exists (security).
3. Resend has a 60s cooldown shown on the button: “Resend in 0:42”.

### Customer

#### Home — `/ (signed in)`
1. Customer Home. Forest band opens the screen; category tiles straddle its edge (brand device).
2. Search box = start a job. It opens Post a job with the text filled in. Category tiles also start a job with that type picked.
3. “Your jobs” shows only jobs that need attention first (Price ready, Tradie found, Done – please confirm). Hidden when the customer has no jobs.
4. Status pill colours: see Job states page. Action-needed pills use the signature colour.
5. Bell → Notifications. Badge counts unread.

#### Post a job · 1 What — `/jobs/new`
1. Full-screen flow, no bottom nav. Close (×) asks “Leave this job? We’ll keep your draft for 24 hours.”
2. Description: required, 10–1000 chars, counter appears at 900.
3. Type: pre-picked if they came from a category tile. Other = any kind of labour (moving, cleaning, gardening, assembly…); “not sure” goes there too and the office re-types it.
4. Draft saves to sessionStorage on every change (existing behaviour, keep it).
5. Next is always enabled; on tap, invalid fields show inline errors and focus the first one.

#### Post a job · 2 Photos — `/jobs/new`
1. At least 1 photo required, max 6. Add tile opens the camera/library (input type=file accept=image/* capture).
2. Thumbnails: 5px radius, × removes (with undo toast). Uploads start immediately with a progress ring on the tile.
3. Failed upload: tile turns red-outlined with “Retry”.
4. Safety tip changes by job type (electrical/gas).

#### Post a job · 3 Where & when — `/jobs/new`
1. Address: NZ address autocomplete (NZ Post / LINZ). Suburb + region are stored separately for search and distance.
2. Privacy: tradies see suburb only until they take the job. Say so under the field.
3. Timing options map to a single field. No calendar booking yet (not built).

#### Post a job · 4 Check & post — `/jobs/new`
1. Review before submit. Every section has Edit (jumps back to that step, keeps everything).
2. Hero CTA (signature colour, Display type) only for the one big moment of a flow.
3. Loading: button shows spinner, all inputs disabled. Never double-submit.
4. Signed-out user: tapping Post it opens a sign-up sheet, then posts automatically. Their draft is never lost.

#### Posted — `/jobs/[id]?posted=1`
1. Success moment. The check pops in with a short scale + bolt flash (motion page). Reduced motion: no animation.
2. Tracker = the customer’s whole journey in 4 words. Same tracker appears on the job page.
3. Push/email permission ask can go here (“Get a ping when your price is ready?”). Ask once only.

#### Job · getting your price — `/jobs/[id] · REVIEW`
1. Job page layout (all states): photo header (swipe gallery, tap to zoom) + white sheet with 22px top radius.
2. Status pill + tracker always at the top. One main action per state.
3. Waiting state: customer can still edit or cancel for free. Copy never mentions estimates or how the price is made.
4. If pricing takes > 24h, add banner: “Still working on it. Thanks for your patience.”

#### Job · price ready — `/jobs/[id] · PRICED`
1. THE moment. Big price in a Forest block, 3 reassurance ticks, hero CTA.
2. Accept & pay → Pay screen. No thanks → sheet: “No worries. Want to tell us why?” (optional reasons) → job closed, free.
3. Price is the saved fixed total from the server. Never recalculate on the client.
4. “Licensed and checked” wording changes per trade (e.g. “Licensed electrician · CoC included” for electrical).

#### Pay — `/pay/[paymentId]`
1. Existing test checkout. Keep the TEST banner until real payments are switched on (both founders sign off).
2. Card form will be the payment provider’s hosted fields (Stripe/Windcave). Style its inputs with our field tokens.
3. Errors: card declined → banner alert at top, keep the method selected, button re-enabled.
4. Success → back to the job page in “Booked” state with a toast “Paid. You’re booked.”

#### Job · booked — `/jobs/[id] · BOOKABLE`
1. Paid, waiting for a tradie to claim. Customer has nothing to do: say so.
2. Cancel after paying = “Request to cancel” in the ⋯ menu → CANCEL_REVIEW (office checks before any refund).
3. If nobody claims in 48h, office gets an alert (not shown to customer).

#### Job · tradie confirmed — `/jobs/[id] · ASSIGNED`
1. Assigned. Tradie card links to their public profile.
2. Call button only if the tradie shares their number (setting). Message is always there.
3. Tracker can collapse earlier steps once there are more than 4.

#### Extra work to approve — `/jobs/[id] · variation`
1. Variation approval as a bottom sheet over the job page. Also arrives as a push notification + message thread card.
2. Approve → same Pay flow for the extra amount. Decline → confirm sheet, then the tradie is told.
3. Photos are required from the tradie for every extra (business rule: “no surprise bills”).

#### Job done · confirm & rate — `/jobs/[id] · SUBMITTED`
1. Sign-off. CoC shown for electrical; other trades show their completion evidence (photos).
2. Stars optional here, required for the review later. Comment field appears after tapping a star.
3. “Something’s not right” → short form to the office (pauses the 48h auto-release).
4. After sign-off: “Sorted.” celebration (bolt flash) + receipt link.

#### My jobs — `/dashboard`
1. Customer “Jobs” tab. Segmented Active / Done.
2. Sort: jobs needing action first, then newest.
3. Row tap → job page. Price shows once known.
4. Empty state: see System states page.

#### Receipt — `/receipts/[jobId]`
1. GST-compliant tax invoice (TM GST number, date, description, GST shown).
2. Refunds show as their own negative line with date.
3. Download → PDF in the receipt style (Forest header).

### Shared

#### Messages — `/messages`
1. One thread per job (customer ↔ assigned tradie). Office messages appear as “Trade Marketplace” with the bolt avatar.
2. Unread: bold name + action-colour count. Sorted by latest message.
3. Same screen in trade mode (orange counts).
4. Empty: “No messages yet. They’ll show up here once a tradie takes your job.”

#### Message thread — `/messages/[jobId]`
1. Bubbles: them = light grey, me = Forest. System events centred grey. Job events (extra work, completed) are cards with an action.
2. Composer: photo + text. Enter sends on desktop; on mobile, the send button. Max 2000 chars.
3. Live updates (poll or websocket). New message announces politely to screen readers (aria-live).
4. Contact details typed into messages are allowed. Phone numbers are not hidden.

#### Notifications — `/notifications`
1. Each row deep-links to the thing (job, thread, receipt). Unread rows get a tint background.
2. Same events go out as push/email (user controls which in Account → Notifications).
3. Already prototyped at /notifications — needs wiring to real events.

#### Account — `/profile`
1. Account tab. Band with avatar (initials if no photo; tap to change).
2. “Work with us” → /for-tradies. A person with BOTH roles gets a “Switch to trade” row instead, which flips data-mode.
3. Log out asks for confirmation.

#### Personal details — `/profile/details`
1. Standard form pattern: box fields, label above, hint below, error below in red with icon.
2. Error border is 2px Danger. Message says how to fix it, not just what’s wrong.
3. Save: disabled until something changes. Success toast “Saved.”

#### Help & support — `/support`
1. Searchable FAQ (accordion rows). Topic chips filter.
2. This is where the “how pricing works” explanation lives for curious customers. Not in the main flow.
3. Message us → opens a support thread with the office (prototype at /support).

#### Tradie profile (public) — `/tradies/[id]`
1. Public, no login needed. Shows first name + trade + region only.
2. Badge wording must match what the office actually checked (“Licence checked”, never “Certified”).
3. Reviews: newest first, reviewer first name + job type. Empty: “No reviews yet.”

### Trade

#### Home · job board — `/jobs (trade home)` (mode: trade)
1. Trade mode: same layout as the original Browse, Hi-Vis/Amber. Bolt in the band is Amber.
2. “Ready to claim” = priced + paid jobs (BOOKABLE) the tradie is eligible for. Price tag shows what THEY earn, never the customer price.
3. “Needs an estimate” = REVIEW jobs in their trade + region. Tile flag “Estimate” instead of a price.
4. Category tiles filter All jobs. Only trades the tradie is verified for are bright; others greyed with “Not verified”.

#### All jobs — `/jobs?view=all` (mode: trade)
1. Original 2-column photo grid (6px gaps, 5px radius). Floating Filter | Sort pill (original).
2. Quick filter chips across the top. Bookmark saves a job (signature colour when saved).
3. “⚡ Estimated” flag = you already sent an estimate (original “Quoted” flag).
4. Infinite scroll, 20 per page, skeleton tiles while loading.

#### Filter — `/jobs (sheet)` (mode: trade)
1. Original filter sheet, simplified. Button shows the live result count.
2. Trades not verified for are visible but disabled with the reason.
3. Filters persist in the URL (?type=&km=&show=) so Back works.

#### Job · needs estimate — `/jobs/[id] · REVIEW` (mode: trade)
1. Original job detail: photo gallery + sheet with Save button + hero CTA (Amber in trade mode).
2. Customer shown by first name + suburb only. Full address after claiming.
3. “4 estimates already sent” builds urgency without showing anyone’s numbers.
4. Not eligible (wrong trade / not verified): hero is replaced by a banner explaining why.

#### Your estimate (blind) — `/jobs/[id]/estimate` (mode: trade)
1. Blind estimate: hours (stepper, 0.5 steps, 0.5–40) + materials $ + optional note.
2. Never show other estimates, the average or the final customer price here.
3. Can edit until the job is priced (then read-only with “Priced at $x — you earn $y”).
4. Site-visit tick flags the job for the office.

#### Estimate sent — `/jobs/[id]` (mode: trade)
1. Same success pattern as the customer “Posted” screen, trade colours.
2. Tile in the grid now shows the “⚡ Estimated” flag.

#### Job · ready to claim — `/jobs/[id] · BOOKABLE` (mode: trade)
1. Claimable job. The money block shows what the tradie earns (hours × their rate). Never the customer price or our margin.
2. Materials budget + Telfer job number are part of the job (business plan).
3. Claim → review sheet (next). Race: if someone else claims first, show “Too slow — someone else got this one.” and return to the list.

#### Claim · review — `/jobs/[id] (sheet)` (mode: trade)
1. Confirm step before claiming (claims are first-come). Primary = claim.
2. Button shows a spinner and blocks double taps. Server is the source of truth for the race.

#### Claimed — `/jobs/[id] · ASSIGNED` (mode: trade)
1. Claim success: bolt mark in a signature circle (bolt flash animation).
2. Numbered next steps = the whole tradie job in four lines.

#### My work — `/dashboard (trade)` (mode: trade)
1. Trade “Jobs” tab. Summary in the band: earned this week, jobs on, rating.
2. Pills tell the tradie their next move (“Message Sarah”, “Upload CoC”), not the database status.
3. Estimates tab: estimates sent and their outcome (Priced / Not taken).

#### Job workspace — `/jobs/[id] · ASSIGNED (trade)` (mode: trade)
1. Everything a tradie needs on site: contact, address, materials job number (copy), tracker, two actions.
2. Directions → opens Maps with the address.
3. ⋯ menu: Can’t do this job (hand back), Report a problem.

#### Request extra work — `/jobs/[id]/variation` (mode: trade)
1. Variation request. Photos required. The office prices it (or a pre-set rate), then the customer approves and pays.
2. Statuses the tradie sees: Sent → Priced → Approved (go ahead) / Declined (don’t do it).
3. While waiting, the job tracker shows “Waiting on Sarah to approve extra work”.

#### Finish job — `/jobs/[id]/complete` (mode: trade)
1. Electrical: CoC number + PDF/photo required (existing server rule).
2. Other trades: evidence fields come from that trade’s config. Until configured, show “Completion for Plumbing is coming soon. Message us to finish this job.”
3. Upload errors inline on the file card with Retry.

#### Earnings — `/earnings` (mode: trade)
1. Payouts from the manual payroll records. Wording: “Queued”, “Paid”. Never claim money moved before it has.
2. Tap a payroll → breakdown per job (hours, rate, holiday pay).
3. Lives under Account on mobile; a top-level tab on desktop.

#### Account & verification — `/profile (trade)` (mode: trade)
1. Verification status is visible at the top. Pending: Amber “Checking your licence (usually 1 working day)”.
2. Trades & licences: one row per trade, each with its own status. Adding a trade = upload licence → office checks.
3. Bank & IRD details are sensitive: masked after saving, re-auth to edit.

### System states

#### Empty state — `any list`
1. Every list has an empty state: illustration (optional) + short heading + one line + one action.
2. Tone: friendly, not sorry. “Nothing on yet.” not “No data found”.
3. Search with no results: “No jobs match that. Try fewer filters.” + Reset filters.

#### Offline / error — `any`
1. Three layers: offline banner (top, persistent), page error (centre, with Try again), toast (short confirmations, 4s, with Undo where possible).
2. Error copy: what happened + what to do. Never show raw error codes; log them.
3. 404 page uses the same layout: “Can’t find that page.” + Go home.

#### Loading — `any`
1. Skeletons that match the real layout (same sizes), never a full-page spinner.
2. Show skeletons only after 300ms; most loads finish before that.
3. Buttons use their own spinner state (components page).

### Desktop

#### Landing (desktop) — `/`
1. Desktop landing ≥1024px. Same content as mobile, wider: hero text left, van right, search + location + hero CTA in one bar.
2. Content max 1200px centred (padding 120 at 1440). Display type 80px on desktop (64 mobile token × 1.25).
3. Below the fold (not shown): popular jobs, reviews, “For tradies” band in Hi-Vis, footer.

#### Customer job (desktop) — `/jobs/[id]`
1. Desktop job page: 2 columns. Left = gallery + details (max 640 text). Right = sticky 400px action card (status, price, CTA, tracker).
2. Same components as mobile, just arranged. No new styles.
3. Bottom nav becomes the Forest top nav at ≥1024px.

#### Job board (desktop) — `/jobs` (mode: trade)
1. Trade desktop: filters become a left sidebar (240px), grid goes 2 → 3 (md) → 4 (lg) columns.
2. Tiles keep the source look (gradient + Display text) at 210px tall.
3. Earnings becomes a top-level tab on desktop.

### Office

#### Office · queues — `/admin` (mode: office)
1. Office mode: Forest sidebar, Mint signature, Forest primary buttons with white labels.
2. Desktop-first (≥1024). On a phone, the sidebar collapses to a top menu and tables become cards.
3. KPI cards = queue counts. Red “Needs you” when something is overdue (e.g. waiting > 24h).
4. Each queue tab is a table: oldest first, one action per row.

#### Office · price a job — `/admin/jobs/[id]/price` (mode: office)
1. Pricing workspace: job left, estimates table, suggested trimmed average, price builder right.
2. Breakdown values come from src/lib/pricing.ts on the server. The UI only displays them.
3. Future auto-pricing (5–10 estimates) uses this same screen to review flagged jobs only.

#### Office · tradie checks — `/admin/tradies` (mode: office)
1. Manual licence check. Register link opens the official register in a new tab.
2. Approve/Reject ask for confirmation + an optional note (stored on the tradie, future audit log).
3. Per-trade verification, one row per trade a person claims.

#### Office · payouts — `/admin/payouts` (mode: office)
1. Existing payroll export + reconciliation, restyled with the table component.
2. Mark paid needs a confirmation that names the batch total.

#### Office · settings — `/admin/settings` (mode: office)
1. Settings form with live example price (server-calculated preview).
2. Save disabled until changed; pending + success states. Values shown here are placeholders: use real settings.

## 8. Copy

Short, straight, friendly. NZ English. Sentence case. Customer screens never explain how it works; trade screens state the next move.

| Say | Not |
|---|---|
| Post a job | Create a request, submit a job |
| Your price | Quote, estimate (to customers) |
| Accept & pay | Proceed to checkout |
| No thanks | Reject quote |
| Tradie / someone local | Service provider, contractor |
| Sorted | Resolved, completed |
| Extra work | Variation (to customers) |
| You earn | Payout amount, remuneration |
| Claim job | Accept assignment |
| Something’s not right | Raise a dispute |

| Moment | Copy |
|---|---|
| Empty jobs | Nothing on yet. |
| Posted | Posted. We’re on it. |
| Price ready (push) | Your price for Sub wiring is ready. |
| Payment done | Paid. You’re booked. |
| Claimed | It’s yours. |
| Claim lost | Too slow. Someone else got this one. |
| Offline | You’re offline. Anything you’ve typed is saved. |
| Generic error | Something went wrong on our end. Try again in a minute. |
| Wrong password | That email and password don’t match. |

Formats: money `$1,284.60` (en-NZ, 2 decimals, say “incl. GST”) · dates `Tue 4 Nov`, times `8am`, `2:30pm` · relative under 7 days (`2h ago`, `Yesterday`) · distance `3.6 km away` (1 decimal under 10 km) · phone `021 555 0192` · job ref `TM-1005` (copyable) · first names in public, full after booking.

## 9. Accessibility (part of done)

1. WCAG 2.2 AA is the bar. Every pair in the colour table passes; don’t invent new ones.
2. Keyboard: every action reachable with Tab, in reading order. Visible focus ring everywhere (2px #2163C6, 2px offset).
3. Tap targets 44×44 minimum, 8px apart.
4. Real elements: <button> for actions, <a> for navigation, <label> on every input, native radios and checkboxes styled.
5. Headings in order (one h1 per screen). Landmarks: header, nav, main.
6. Status changes announced: role="status" for toasts and saved states, role="alert" for errors.
7. Images: job photos get alt from the job title (“Photo 1 of 3: Sub wiring”). Illustrations alt="".
8. Text zoom 200% and 320px width: no horizontal scroll, nothing cut off.
9. Respect prefers-reduced-motion: no bolt flash, no slide-ins, instant changes.
10. Never colour alone: pills have words, errors have icons + text, the active tab is filled + has a bar.

## 10. Motion

| What | Timing | Where |
|---|---|---|
| Press | 120ms · scale .98 | Buttons, cards, tiles |
| State change | 200ms · ease-out | Chips, tabs, pills, toggles |
| Sheet in | 320ms · ease-out · from bottom | Sheets, filters |
| Sheet out | 200ms · ease-in-out |  |
| Page | 200ms fade + 8px rise | New page content (not the nav) |
| Toast | 200ms in · 4s · 200ms out | Pauses on hover/focus |
| Bolt flash | 400ms: tick scales 0.6→1.08→1, Lime/Amber glow 0→40%→0 | Only big wins: Posted, Paid, Claimed, Sorted |
| Skeleton | 1.2s shimmer loop | Shown after 300ms delay |

## 11. Build

Stack stays: Next.js 15 App Router, server components + server actions, Tailwind v4 + CSS modules. Replace `src/styles/brand.css` with `tokens.css`. Suggested components: `ui/` Button, Field, Choice, Upload, StatusPill, Card, JobTile, JobRow, CategoryTile, PriceBlock, Tracker, Sheet, Banner, Toast, Avatar, Stars, Icon, Empty, Skeleton; `shell/` BottomNav, TopNav, AppBar, BandHeader, OfficeSidebar, ModeProvider. Fonts: `public/fonts/roboto-flex/RobotoFlex.woff2`, `public/fonts/material-symbols/MaterialSymbolsRounded.woff2`.

```tsx
// app/layout.tsx — set mode on the server (no flash)
const mode = !user ? "customer" : user.role === "ADMIN" ? "office" : user.role === "TRADIE" ? "trade" : "customer";
return <html lang="en-NZ" data-mode={mode}>…
```

Performance: LCP < 2.5s on 4G, next/image, preload fonts, < 170 KB JS per route. Testing: Playwright at 320/390/768/1024/1440, axe on every route, visual snapshots of each screen. Security: uploads (CoC, licences) behind auth before launch; no payment keys in the client; rate-limit auth + messages.

### What changes in today’s code (feature/hosted-demo-preview-20261022)

| Area | Today | Change to |
|---|---|---|
| Tokens | brand.css has no orange or mode tokens | Replace with kit/tokens.css; add data-mode |
| Status chips | Tailwind amber/sky colours in JOB_STATUS | StatusPill kinds (Job states page) |
| Category icons | Emoji ⚡🔧🔥🔨 + Tailwind tints | 3D illustrations + category tints |
| Stars | text-amber-500 ★ | Signature colour, Stars component |
| CTA labels | Forest-label fix applied by hand, screen by screen | --trade-on-action token in the Button component |
| Nav icons | Original SF glyph outlines (temporary OK) | Material Symbols before launch |
| Trade colour | Tradie screens are green | data-mode="trade" → Hi-Vis/Amber |
| Copy | Electrician/CoC wording everywhere; 4 categories only | Per-trade labels from one config; add “Other” (any labour) |
| Customer copy | “Tradies provide private estimates… TM sets your price” on post/dashboard | Post it · accept the price · sorted (how-it-works lives in Help) |
| Desktop | Centred 390px frame on wide screens | Desktop layouts (section 06) |
| Old docs | frontend-handoff.md etc. conflict | This guide supersedes; archive them |

### Build order

1. **Foundations** (2–3 days): tokens.css + fonts + icons; ModeProvider + data-mode; Button, Field, Icon, StatusPill; Status label map
2. **Components** (1 week): Cards, tiles, rows, price block; Sheet, banner, toast, tracker; Shell: nav, app bar, band header; Empty, error, skeleton
3. **Customer flow** (1–2 weeks): Home, post a job (4 steps); Job page, all states; Pay, receipt, my jobs; Extra work, sign-off, review
4. **Trade flow** (1–2 weeks): Job board, all jobs, filter; Estimate, claim (race-safe); Workspace, extra work, finish; My work, earnings, verification
5. **Shared + office** (1–2 weeks): Messages, notifications, account; Office queues, price a job; Tradies, payouts, settings; Desktop layouts, QA pass

### Definition of done

- [ ] Matches the screen in this guide at 390 and the desktop rules
- [ ] Uses tokens and kit components only (no hex, no one-off styles)
- [ ] Loading, empty, error and success states all built
- [ ] Keyboard + screen reader pass; axe has no violations
- [ ] Works at 320 / 390 / 768 / 1024 / 1440 with no sideways scroll
- [ ] Copy matches section 07; numbers from the server
- [ ] lint · typecheck · test · build all green (CI)
- [ ] PR has screenshots (mobile + desktop) and names who/which AI built it

### Decided (23 Oct 2026)

Decisions now live in the Web App Design Spec kit (DECISIONS.md) and override this guide where they differ: anyone can take Other jobs (licensed trades need a licence on file); a gold $30 quote bounty (24h) when the AI cannot price, which comes off the final price; team jobs with one lead; Stripe + Apple Pay in test mode until the end; Mapbox; booking windows instead of chat; phone hidden until claimed; launch in Invercargill.
