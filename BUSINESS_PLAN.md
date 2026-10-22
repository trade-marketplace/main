# Trade Marketplace — Business Plan

> **Needs work: read this first.** This is William's October 2026 draft, carried over from the old repo. The founders
> made decisions on 23 Oct 2026 (see `DECISIONS.md`) that change parts of it. Where they disagree, **DECISIONS.md wins**.
> Still being reworked:
>
> - **Scope:** the plan below is electrical-first. We now launch in **Invercargill** with Electrical, Plumbing, Gas
>   fitting, Construction **and Other (any kind of labour)**. Restricted work still needs a licence on file.
> - **Pricing:** the rate maths below (built up from the worker's rate) still stands. Open: one shared rate + an Other
>   rate at launch (configurable), and William's revised pricing structure.
> - **Site visits → quote bounties:** when the AI can't price a job, a gold **$30 quote bounty** (24h) replaces the
>   "paid site visit". The customer's $30 comes off the final price.
> - **Auto-pricing → AI pricing:** the trimmed-average idea becomes the Trade Marketplace AI pricing check (estimates +
>   its own prediction). Thresholds and what counts as "fair" are still to decide.
> - **Estimate credits / first pick:** replaced for quotes by "first dibs if your quote is accepted and fair".
> - **Team jobs:** one lead per job sets each person's split; everyone is paid their share through payroll.
> - **Verified quoters:** a new invite-only role: $30 per quote + 2% when accepted, fair and no dispute + weekly
>   accuracy bonus. What the 2% is a share of is still to decide.
> - **Messages:** replaced where possible by booking windows and preset updates. Phone numbers hidden until claimed.
> - **Payments:** Stripe with Apple Pay, test mode until both founders agree.

*Draft, October 2026. Electrical first; other trades later.*

## The problem

- **Sparkies:** plenty of licensed electricians would do side jobs, but not the hassle that comes with them — finding
  customers, quoting, invoicing, GST, tax returns, chasing payment.
- **Customers:** homeowners struggle to get anyone to turn up for small jobs (a plug, a few downlights, a heat pump
  circuit), and when they do, they don't know if the price is fair.

## The idea

Trade Marketplace (TM) is a **managed service**, not a listing site. TM sets one fair fixed price, takes the
customer's payment up front, and pays the sparky per job with tax handled. The sparky just picks a job, does the
work and uploads the CoC.

### Why TM sets the price

| Who sets the price | What happens |
|---|---|
| Tradies | They undercut each other — race to the bottom |
| Customers | They lowball — no good tradie stays |
| **TM** | **Built up from a fair tradie rate — both sides happy** |

## How a job works

1. **Customer posts the job** with photos. Free.
2. **Sparkies estimate it blind** (hours + materials) — nobody sees anyone else's numbers.
3. **Price is set** — see *Pricing* below.
4. **Customer pays up front** before anyone turns up.
5. **A sparky claims the job** and sees exactly what they'll earn before taking it.
6. **Materials go on TM's Telfer trade account** under the job number (e.g. `TM-1005`), within a set budget.
7. **Extra work?** Sparky uploads photos → it's priced → customer approves and pays → then the work is done.
8. **Sparky uploads a valid CoC** → customer confirms (or 48 hrs pass) → sparky is paid through payroll.
9. **Customer cancels after paying?** TM investigates before any refund. Before paying, they can cancel freely.

## Pricing

The price is built **up** from the tradie's rate, so the sparky is never cut short:

```
tradie gross   = hours × tradie rate            $60/hr
on-costs       = holiday pay, KiwiSaver, ACC    12.5%
TM margin      = on labour + materials          20%
GST                                             15%
```

| Per hour of work | |
|---|---|
| Sparky earns (incl. 8% holiday pay) | **$64.80** |
| TM keeps (before costs) | ~$16 |
| Customer pays (incl GST) | **~$93** |

Minimum 2 hours per job. Materials at cost plus margin. All rates adjustable.

### Planned: sparkies price the jobs (not built yet)

- **Auto-pricing:** once a job has **5–10 estimates**, the price is the **trimmed average** (drop the highest and
  lowest, average the rest). Sent to the customer automatically.
- **Sent to TM instead when:** estimates disagree a lot (job probably needs a site visit), fewer than 5 estimates
  after 24 hrs, or the price is way off the standard-job menu.
- **Estimate credits:** estimating earns the right to take jobs (e.g. 3 accurate estimates = 1 job credit). Only
  estimates close to the final price earn credit.
- **First pick:** the most accurate estimator gets a head start of a few hours to claim that job.
- **Starter credits** for new sparkies; a cap so nobody hoards jobs.
- **Anti-padding:** watch how often customers decline prices, compare estimates with how jobs actually went, and
  flag sparkies who consistently estimate high.

## Why sparkies join

- **$64.80/hr** vs roughly $40/hr employed, 2-hour minimum.
- **Zero paperwork** — no GST, invoices or IR3.
- **No risk** — customer has already paid, materials are on TM's account.
- **Pick their own jobs** — evenings and weekends.

## Why customers use it

- **One fixed price** (~$93/hr incl GST), less than a typical call-out company.
- **Verified, licensed electricians** and a **CoC every time**.
- **No surprise bills** — extra work is photographed and approved first.

## How TM makes money

The margin on every job (default 20%). On a $505 job that's about $73, before card fees (~$14), insurance,
accounting, payroll software, callbacks and time — realistically **$40–50 kept per job**. Test this in the pilot;
it may need to be 25–30% or a small booking fee.

| Volume | Rough yearly profit |
|---|---|
| 10 jobs/week (Southland) | ~$13k — side income |
| 50 jobs/week (a few regions) | ~$65k — a real business |

## What TM is responsible for

TM is effectively an electrical contracting company:

- **Company + GST registration**
- **Payroll** — sparkies as casual employees (PAYE, 8% holiday pay, KiwiSaver, ACC). Safer than contractors,
  because setting the price makes them look like employees anyway.
- **Insurance** — public liability, probably professional indemnity.
- **Telfer trade account** — likely needs a personal guarantee.
- **Customer contract** — under the Consumer Guarantees Act, complaints come to TM, not the sparky.

## Risks and fixes

| Risk | Fix |
|---|---|
| Can't price some jobs from photos | Fixed-price menu for standard jobs; paid site visit for unclear ones |
| Founder is the bottleneck (pricing, variations, disputes) | Auto-pricing from estimates; pre-set variation rates customers approve in the app |
| Employed sparkies' contracts may ban competing side work | Target sole traders, semi-retired and between-jobs sparkies first; sparky confirms their employer allows it |
| Employees must be paid for all hours, including callbacks and overruns | Budget for it in the margin; proper employment agreement |
| Thin margin | Check real costs in the pilot; adjust margin or add a booking fee |
| Customers wary of paying in full up front | Deposit to book, balance on CoC; payment held until job done |
| Paid job nobody claims | Only take payment where there are sparkies; "booked in 5 days or full refund"; TM can assign directly |
| Customer and sparky go direct next time | Non-solicit clause; "no paperwork, guaranteed pay" is worth more than cash jobs |
| A CoC doesn't prove good work | Customer reviews, spot checks, remove sparkies after complaints |
| Materials misuse or Telfer errors | Per-job budget; check every packing slip; over-budget flag |

## Plan

1. **Accountant** — employment vs contractor, GST, payroll, Telfer guarantee.
2. **Talk to 10 sparkies** — would they do it at $64.80/hr? What do their employers allow?
3. **Pilot** — founder + 1–2 sparky mates, one city, 10–20 real jobs.
4. **Check the numbers** — sparkies happy? customers paying? margin enough?
5. **Grow** — more sparkies, more regions, then other trades.

## Where the product is at

**Built and working** (`web-app` branch): job posting, blind estimates, TM pricing, upfront payment, job claiming,
Telfer job numbers + materials budgets, variations, CoC upload, customer sign-off, 48-hr auto-release, payouts with
holiday pay, payroll CSV export, cancellation investigations, licence verification, reviews, admin dashboard.

**Needed before real customers:** real payments (Stripe — currently test mode), notifications (email/SMS),
auto-pricing + estimate credits, fixed-price menu, payroll integration, secure file access for CoCs, legal setup,
hosting.
