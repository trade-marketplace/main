# Decisions

Decided by Matt (Co-Founder/CEO) on 23 October 2026. These override older wording in the Front-End Build Guide, the Web App Design Spec and the mockups.

1. **Who can take jobs.** Anyone can take Other jobs and unrestricted work. Checks are loose at the start; checked workers get a verified badge. Restricted work (electrical, plumbing, gasfitting, drainlaying, restricted building work) still needs a licence on file before claiming.
2. **Quote bounties.** When the Trade Marketplace AI can’t settle a price from photos + estimates, a $30 quote bounty appears (gold on the map, 24h). Anyone good can claim it, visit in a customer window, and send a fixed price. The AI checks it against the estimates and its own prediction.
3. **Who pays the $30.** The customer books a $30 quick look; it comes off the final price if they go ahead.
4. **First dibs.** The quoter gets first dibs only if their price is accepted and the AI deems it fair. Way-off quotes are ignored and the job opens to everyone.
5. **Team jobs.** One lead per job. The lead sets each person’s split and invites crew (accept/decline). Everyone is paid their share through payroll. The customer only sees the lead. Later: request a specialist inside a job.
6. **Verified quoters.** Invite only, tougher screening. Earn $30 per quote + 2% of jobs where their price is accepted, fair and the job finishes without a dispute + a weekly bonus for accurate quotes.
7. **Payments.** Stripe, with Apple Pay. Real payments switch on last, after lots of testing.
8. **Map.** Mapbox for now.
9. **Rates.** One shared rate + an Other rate at launch; per-trade rates possible later (configurable in Settings).
10. **Scheduling.** Customers give time windows; workers book one. Preset updates (on my way, running late, reschedule) instead of chat where possible.
11. **Phone numbers.** Hidden until a job is claimed, then both sides can see them.
12. **Launch area.** Invercargill.

## Decided since (closed decision issues)

- **Domain** (#209, Matt): primary **trademarketplace.nz**; **trademarketplace.co.nz** is intended to redirect to it. The primary domain is verified and live on Vercel (connector checked 29 October 2026); the .co.nz purchase/redirect has not been verified. See `docs/SERVICES.md`.
- **Email, push and SMS** (#63, Matt): **Resend** for email from **hello@trademarketplace.nz**; **Firebase** web push for job alerts and pings. **No SMS at launch** (cost); revisit with more users.
- **Analytics and cookies** (#234, Matt): privacy-friendly analytics (**Plausible or Fathom**), so the cookie banner informs only, no consent choices.
- **Hosting and database** (#58, William): **Vercel** for the app + **Supabase Postgres**, both in the **Sydney** region. Free tiers until launch; at launch upgrade Supabase to Pro (daily backups, no inactivity pausing) and Vercel to Pro (Hobby is non-commercial only), ~US$45/mo. Supabase also covers auth, file storage and realtime.
- **File storage** (#59, William): **Supabase Storage**, private buckets, viewed only through signed URLs that expire. Access enforced by Storage policies tied to Supabase Auth. Photos resized before upload to stay inside the 1 GB free tier; Cloudflare R2 is the fallback if storage gets big.
- **Sign-in** (#60, William): **Supabase Auth**, not a port of the prototype's jose/bcrypt sessions. Email + password at launch; magic links and Google/Apple later. Users live in our own Supabase Postgres; free to 50k monthly users. Auth emails go through Resend.
- **Scheduled jobs** (#61, Matt): **Supabase pg_cron**, every minute (bounty expiry, 48h auto sign-off, reminders, unclaimed alerts). Vercel Cron's free plan only runs daily.
- **Launch rates** (#62, Matt, revised by William 26 Oct): **$70/hr licensed trades, $38/hr Other** to the worker, 20% margin, 2-hour minimum (licensed) / 1-hour (Other). Customer pays about $117/hr incl GST licensed, ~$64/hr Other. Goal: licensed tradies can almost replace a full-time job. Editable in office Settings; priced jobs keep their rates.
- **Trades** (#333, Matt, 27 Oct): launch with **Electrical, Plumbing, Gas, Construction + Other**, as now. After launch, **all trades**: trades become a list the office manages in Settings (add, rename, hide), shown as umbrella tiles (draft list on #333). **Garden and Cleaning are separate umbrellas.** **Rates per trade are set by the office** in Settings, starting from the launch licensed / Other rates. **Anyone can take unlicensed skilled work** (tiling, painting…) for now; restricted work still needs a licence on file (1). Who builds the backend for it isn't decided yet.
- **No account lockout** (Matt, 27 Oct, #340): wrong passwords **never lock an account**, however many there are. The only "Too many tries" message is when Supabase's own rate limit answers; any limit #111 adds must slow things down, never lock the account.
- **Stay logged in as long as possible** (Matt, 27 Oct, #340): "Keep me logged in" (ticked by default) keeps people logged in for 400 days from their last visit, the longest browsers allow. Unticked, it ends when the browser closes.
- **Log in before confirming email** (Matt, 27 Oct, #340): yes. People can log in straight after signing up and see a "Confirm your email" banner; they **can't post a job or take one** until they've clicked the link. William turns off Supabase's "Confirm email" setting for this.
- **Password reset sessions** (Matt, 29 Oct, #107): revoke sessions globally after a password reset, using Supabase's normal refresh-token revocation. Already-issued access tokens may remain valid until their normal expiry; immediate rejection on other devices is not required.
- **No "we do the paperwork"** (Matt, 27 Oct, #341, #344): never say it, anywhere, though older mockups and the spec do. The tradie line is **"You do the work. We find the jobs."**
- **Country naming** (Matt, 28 Oct, #356): use **“New Zealand”** exclusively in product and brand copy, documentation, examples and design references. The footer says **“Made in New Zealand”**. Do not use alternate country names.
- **Worker pay labels** (Matt, 28 Oct): show **"Earn $…"**, rather than "You earn $…", on worker pay labels, map/list cards and their accessible names.
- **Coverage area** (Matt, 26 Oct): **60 km around Invercargill** (centre -46.4132, 168.3538). Stored in office Settings (`settings.coverage_*`), so the office can change it without a deploy; editing it from the office Settings screen (F14, Coverage tab) comes with that page.
- **Pointer focus** (Matt, 29 Oct, #378): clicks and taps must not leave a visible focus box or tap highlight. Reuse the shared `FocusVisibility` behaviour and focus token; keyboard focus remains visible (M05), including Tab, arrow navigation and focus moved by keyboard interactions. Do not blur controls or globally remove keyboard focus.

### Homepage implementation (#211, Matt, 29 Oct)

- Signed-in customers see the public homepage until C01 is built. Tradies and office users keep their existing role-home redirects.
- Finish the homepage with tested hand-offs that preserve the entered job text, category and location. The Post a Job wizard and outside-area waitlist destination pages remain in their own issues.
- Keep the homepage's explanatory mockup copy: step paragraphs, category sublabels, promise paragraphs and fuller FAQ answers/intro. Remove the three eyebrows (How it works, What can we sort?, Why Trade Marketplace). This is useful supporting copy under the revised copy rule; do not cut this text again.
- Keep the review section with the design examples until real reviews exist, visibly labelled **Example reviews**. Real reviews replace these automatically when available.
- The floating public product illustration may use the design example's **$372.00** for now. It is decorative marketing artwork, not a live quote or payment control. Real job prices continue to come from the server.

## Still to decide

- [ ] Legal check: restricted work rules + platform liability (lawyer)
- [ ] AI pricing thresholds and what counts as a “fair” quote
- [ ] What the 2% is a share of (labour, or the whole job?) and the weekly bonus amount
- [ ] What happens when a bounty expires or the customer says no to the $30 look
- [ ] Who builds the AI pricing model, and when
- [ ] Quoting (#279, William's proposal, needs Matt): Trade Marketplace sets every price. Price book for standard jobs, median of 3 blind hour estimates for the rest, $30 site visit when estimates disagree, 1 point per estimate and points needed to accept jobs. Would replace the AI-priced bounty, first dibs and verified-quoter pay model above.
- [ ] Onboarding and safety for unlicensed workers (#280, William's proposal, needs Matt + lawyer): strict checks before first job (ID, skills check per category, safety induction, banned-work list, hazard check per job, probation, liability insurance). Would replace "checks are loose at the start".

## Flags

- New server statuses implied: `QUOTE_BOUNTY`, crew/lead on a job, verified-quoter role, booking windows. These change `prisma/schema.prisma` and need William’s review.
- Payments stay in test mode until both founders agree to switch them on.
