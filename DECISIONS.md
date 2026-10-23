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

- **Domain** (#209, Matt): primary **trademarketplace.nz**; **trademarketplace.co.nz** redirects to it. Both still need buying.
- **Email, push and SMS** (#63, Matt): **Resend** for email from **hello@trademarketplace.nz**; **Firebase** web push for job alerts and pings. **No SMS at launch** (cost); revisit with more users.
- **Analytics and cookies** (#234, Matt): privacy-friendly analytics (**Plausible or Fathom**), so the cookie banner informs only, no consent choices.

## Still to decide

- [ ] Legal check: restricted work rules + platform liability (lawyer)
- [ ] AI pricing thresholds and what counts as a “fair” quote
- [ ] What the 2% is a share of (labour, or the whole job?) and the weekly bonus amount
- [ ] What happens when a bounty expires or the customer says no to the $30 look
- [ ] Who builds the AI pricing model, and when

## Flags

- New server statuses implied: `QUOTE_BOUNTY`, crew/lead on a job, verified-quoter role, booking windows. These change `prisma/schema.prisma` and need William’s review.
- Payments stay in test mode until both founders agree to switch them on.
