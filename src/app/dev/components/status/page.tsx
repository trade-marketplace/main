// /dev/components/status: every status pill, tracker and price block (#77) in every variant and state, for
// checking against docs/design/components.css, web.css and the mockups. `?mode=trade` / `?mode=office` switch the
// palette and whose labels are shown. Development only: in a production build this page is a 404.
// Prices, names and counts are examples.
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { BoltMark } from "@/components/BoltMark";
import { BountyPill } from "@/components/status/BountyPill";
import { Pill } from "@/components/status/Pill";
import { PriceBlock } from "@/components/status/PriceBlock";
import { StatusPill } from "@/components/status/StatusPill";
import { Tracker } from "@/components/status/Tracker";
import {
  type Audience,
  audienceForMode,
  AUDIENCES,
  JOB_STATUSES,
  type JobStatus,
  PILL_KINDS,
  type StatusContext,
  statusPill,
} from "@/lib/job-status";
import { jobTracker } from "@/lib/job-tracker";
import { DEFAULT_MODE, isMode, MODES, type Mode } from "@/lib/mode";
import { guardDevPage } from "@/server/dev-pages";

import { PriceRevealDemo, ReducedMotionNote, StatusChangeDemo, TrackerProgressDemo } from "./StatusPreview";
import styles from "./status-preview.module.css";

export const metadata: Metadata = {
  title: "Status components (dev)",
  robots: { index: false, follow: false },
};

const MODE_NAMES: Record<Mode, string> = { customer: "Customer", trade: "Trade", office: "Office" };
const AUDIENCE_NAMES: Record<Audience, string> = { customer: "Customer", tradie: "Tradie", office: "Office" };

type Row = { status: JobStatus; context?: StatusContext; note?: string };

/** One row per status, then the variants that change a pill (sitemap "ASSIGNED + variation" etc.). */
const ROWS: Row[] = JOB_STATUSES.flatMap((status): Row[] => {
  switch (status) {
    case "BOOKABLE":
      return [{ status }, { status, context: { unclaimedOverdue: true }, note: "unclaimed > 48h" }];
    case "ASSIGNED":
      return [
        { status },
        { status, context: { customerFirstName: "Sarah" }, note: "customer’s name known" },
        { status, context: { onNow: true }, note: "booked time is now" },
        { status, context: { extraWork: true }, note: "+ extra work" },
      ];
    case "COMPLETED":
      return [
        { status },
        { status, context: { payout: "QUEUED" }, note: "payout queued" },
        { status, context: { payout: "PAID" }, note: "payout paid" },
      ];
    default:
      return [{ status }];
  }
});

const TICKS = ["Labour, parts and call-out included", "Fixed: it won’t go up", "Saying no is free"];
const LONG_NAME = "Wiremu Hēnare-Fitzgerald-MacPherson of Invercargill Electrical Services Limited";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function StatusComponentsPage({ searchParams }: { searchParams: SearchParams }) {
  guardDevPage();

  const params = await searchParams;
  const mode: Mode = isMode(params.mode) ? params.mode : DEFAULT_MODE;
  const audience = audienceForMode(mode);
  // The office has no tracker of its own (its job page shows the audit timeline, F05): show both sides.
  const trackerAudiences: Audience[] = audience === "office" ? ["customer", "tradie"] : [audience];

  return (
    <div className={styles.page} data-mode={mode}>
      <header className={styles.band}>
        <BoltMark variant="hero" className={styles.bandBolt} />
        <div className={styles.wrap}>
          <p className={styles.eyebrow}>Dev only · not in production builds</p>
          <h1 className={styles.title}>Status components</h1>
          <p className={styles.lede}>
            Status pills, the job tracker and the price block (#77), in every variant and state. Pills and trackers
            show the <b>{AUDIENCE_NAMES[audience].toLowerCase()}</b> labels in {MODE_NAMES[mode].toLowerCase()} mode
            colours; switch mode to see the others. Names and prices are examples.
          </p>
          <nav aria-label="Mode" className={styles.modeNav}>
            {MODES.map((m) => (
              <Link
                key={m}
                href={m === DEFAULT_MODE ? "/dev/components/status" : `/dev/components/status?mode=${m}`}
                aria-current={m === mode ? "page" : undefined}
                className={styles.modeLink}
              >
                {MODE_NAMES[m]}
              </Link>
            ))}
          </nav>
          <ReducedMotionNote />
        </div>
      </header>

      <main className={styles.wrap}>
        <nav aria-label="Sections" className={styles.toc}>
          <a href="#pills">Status pills</a>
          <a href="#kinds">Pill kinds</a>
          <a href="#bounty">Quote bounty</a>
          <a href="#m25">M25 Status change</a>
          <a href="#tracker">Tracker</a>
          <a href="#m11">M11 Tracker progress</a>
          <a href="#price">Price block</a>
          <a href="#m09">M09 Price reveal</a>
          <a href="#long">Long text</a>
          <a href="#usage">Usage</a>
        </nav>

        <Section id="pills" title="Status pills">
          <p className={styles.what}>
            One per job status in <code>prisma/schema.prisma</code> (the <code>JobStatus</code> enum), worded for
            the {AUDIENCE_NAMES[audience].toLowerCase()} (<code>docs/design/sitemap.json</code> <code>job_statuses</code>).
            “Not shown” means this audience never sees a pill for it.
          </p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <caption className={styles.srOnly}>{AUDIENCE_NAMES[audience]} pill for each job status</caption>
              <thead>
                <tr>
                  <th scope="col">Server status</th>
                  <th scope="col">{AUDIENCE_NAMES[audience]} pill</th>
                  <th scope="col">All three labels</th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((row) => {
                  const key = `${row.status}-${row.note ?? ""}`;
                  return (
                    <tr key={key}>
                      <th scope="row">
                        <code>{row.status}</code>
                        {row.note ? <span className={styles.rowNote}>{row.note}</span> : null}
                      </th>
                      <td>
                        {statusPill(row.status, audience, row.context) ? (
                          <StatusPill status={row.status} audience={audience} context={row.context} />
                        ) : (
                          <span className={styles.hiddenNote}>Not shown</span>
                        )}
                      </td>
                      <td>
                        <ul className={styles.labels}>
                          {AUDIENCES.map((a) => (
                            <li key={a}>
                              <span className={styles.labelWho}>{AUDIENCE_NAMES[a]}:</span>{" "}
                              {statusPill(row.status, a, row.context)?.label ?? "(not shown)"}
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>

        <Section id="kinds" title="Pill kinds">
          <p className={styles.what}>
            Colour by meaning. <code>action</code> is the mode’s signature colour (Lime, Amber, Mint); the rest are the
            same in every mode. Gold is for quote bounties only. For the other pills in the kit (Paid, Refunded,
            Checking) use <code>&lt;Pill kind&gt;</code>.
          </p>
          <ul className={styles.row}>
            {PILL_KINDS.map((kind) => (
              <li key={kind}>
                <Pill kind={kind}>{kind}</Pill>
              </li>
            ))}
          </ul>
        </Section>

        <Section id="bounty" title="Quote bounty">
          <p className={styles.what}>
            The gold pill for bounty pins, cards and pings. On a card it can glint every 4s (M27).
          </p>
          <ul className={styles.row}>
            <li>
              <BountyPill />
            </li>
            <li>
              <BountyPill label="Bounty" detail="17h" />
            </li>
            <li>
              <BountyPill label="New bounty" detail="2.1 km" />
            </li>
          </ul>
          <div className={styles.bountyCard}>
            <BountyPill glint />
            <b>Hot water cylinder</b>
            <span className={styles.caption}>Glints every 4s · 6 km · Waikiwi</span>
          </div>
        </Section>

        <Section id="m25" title="M25 Status change">
          <p className={styles.what}>
            When a job moves on while the page is open, the pill cross-fades and pulses once. The pill at the top of a
            job page announces the new status to screen readers (<code>announce</code>).
          </p>
          <StatusChangeDemo audience={audience} />
        </Section>

        <Section id="tracker" title="Tracker">
          <p className={styles.what}>
            The tracker for each status (<code>jobTracker()</code>). Tradies only get one once they’ve claimed the job;
            the office’s job page shows its audit timeline instead, so office mode shows both sides.
          </p>
          {trackerAudiences.map((who) => (
            <div key={who} className={styles.subsection}>
              {trackerAudiences.length > 1 ? <h3 className={styles.subTitle}>{AUDIENCE_NAMES[who]} side</h3> : null}
              <ul className={styles.cards}>
                {JOB_STATUSES.flatMap((status) => {
                  const variants: { key: string; title: string; options?: Parameters<typeof jobTracker>[2] }[] = [
                    { key: status, title: status },
                  ];
                  if (status === "ASSIGNED") variants.push({ key: `${status}-extra`, title: "ASSIGNED + extra work", options: { extraWork: true, customerFirstName: "Sarah" } });
                  if (status === "COMPLETED" && who === "tradie") variants.push({ key: `${status}-paid`, title: "COMPLETED · paid", options: { payout: "PAID" } });
                  if (status === "ASSIGNED" && who === "tradie") variants.push({ key: `${status}-photos`, title: "ASSIGNED · not electrical", options: { evidence: "photos" } });
                  return variants.map((v) => {
                    const model = jobTracker(status, who, { tradieName: "Jack Wilson", ...v.options });
                    const pillContext: StatusContext = { extraWork: v.options?.extraWork, payout: v.options?.payout };
                    return (
                      <li key={v.key} className={styles.card}>
                        <div className={styles.cardHead}>
                          <code>{v.title}</code>
                          {statusPill(status, who, pillContext) ? (
                            <StatusPill status={status} audience={who} context={pillContext} />
                          ) : null}
                        </div>
                        {model ? (
                          <Tracker steps={model.steps} current={model.current} label={`${AUDIENCE_NAMES[who]} tracker, ${v.title}`} />
                        ) : (
                          <p className={styles.hiddenNote}>No tracker for this status</p>
                        )}
                      </li>
                    );
                  });
                })}
              </ul>
            </div>
          ))}
        </Section>

        <Section id="m11" title="M11 Tracker progress">
          <p className={styles.what}>
            When the job moves to the next step, the line fills down to it (400ms), then its dot pops and its label
            fades in.
          </p>
          <TrackerProgressDemo />
        </Section>

        <Section id="price" title="Price block">
          <p className={styles.what}>
            The customer sees their fixed price only; the tradie sees what they earn only. The props can’t take the
            other side’s number. The bolt is the mode’s signature colour.
          </p>
          <div className={styles.prices}>
            <div>
              <h3 className={styles.subTitle}>Customer version</h3>
              <PriceBlock audience="customer" priceCents={37200} ticks={TICKS} />
            </div>
            <div>
              <h3 className={styles.subTitle}>Tradie version</h3>
              <PriceBlock audience="tradie" earnCents={25920} breakdown={{ minutes: 240, rateCents: 6480, holidayPay: true }} />
            </div>
            <div>
              <h3 className={styles.subTitle}>Tradie version, no breakdown</h3>
              <PriceBlock audience="tradie" earnCents={3000} />
            </div>
          </div>
        </Section>

        <Section id="m09" title="M09 Price reveal">
          <p className={styles.what}>
            Once per event: the block wipes in, the number counts up from $0, the underline draws, then the ticks
            appear one by one. A refresh or a second visit shows it straight away.
          </p>
          <PriceRevealDemo ticks={TICKS} />
        </Section>

        <Section id="long" title="Long text">
          <p className={styles.what}>
            Very long names and labels wrap (or, in dense tables, truncate with the full text in a tooltip) and never
            overflow. Each box below is narrow on purpose.
          </p>
          <div className={styles.narrowGrid}>
            <div className={styles.narrow}>
              <h3 className={styles.subTitle}>Pill that wraps</h3>
              <Pill kind="action">Waiting on Wiremu Hēnare-Fitzgerald to approve the extra work</Pill>
            </div>
            <div className={styles.narrow}>
              <h3 className={styles.subTitle}>Pill that truncates</h3>
              <Pill kind="good" truncate>
                Paid · Visa ending 4242 · 31 October 2026
              </Pill>
            </div>
            <div className={styles.narrow}>
              <h3 className={styles.subTitle}>Bounty, long detail</h3>
              <BountyPill label="New bounty" detail="2.1 km · Otatara, Invercargill" />
            </div>
            <div className={styles.narrow}>
              <h3 className={styles.subTitle}>Status pill, long name</h3>
              <StatusPill status="ASSIGNED" audience="tradie" context={{ customerFirstName: "Wiremu-Hēnare-Fitzgerald" }} />
            </div>
            <div className={styles.narrow}>
              <h3 className={styles.subTitle}>Tracker, long names</h3>
              <Tracker
                label="Tracker with long names"
                current={1}
                steps={[
                  { label: "Price accepted" },
                  { label: "Tradie confirmed", note: LONG_NAME },
                  { label: "Sorted, signed off and everything tidied away afterwards" },
                ]}
              />
            </div>
            <div className={styles.narrow}>
              <h3 className={styles.subTitle}>Big price</h3>
              <PriceBlock audience="customer" priceCents={123456789} ticks={["A very long reassurance line that has to wrap onto several lines in a narrow box"]} />
            </div>
          </div>
        </Section>

        <Section id="usage" title="Usage">
          <pre className={styles.code}>
            <code>{USAGE}</code>
          </pre>
        </Section>
      </main>
    </div>
  );
}

const USAGE = `import { StatusPill } from "@/components/status/StatusPill";
import { Tracker } from "@/components/status/Tracker";
import { PriceBlock } from "@/components/status/PriceBlock";
import { BountyPill } from "@/components/status/BountyPill";
import { jobTracker } from "@/lib/job-tracker";

// Customer job page (C07–C14): the pill at the top announces changes.
<StatusPill status={job.status} audience="customer" announce />
const tracker = jobTracker(job.status, "customer", { tradieName });
{tracker && <Tracker {...tracker} />}
<PriceBlock audience="customer" priceCents={job.priceCents} ticks={ticks}
  revealId={\`price-ready:\${job.id}\`} />

// Tradie claim page (D06): what they earn, never the customer's price.
<PriceBlock audience="tradie" earnCents={pay.earnCents}
  breakdown={{ minutes, rateCents, holidayPay: true }} revealId={\`you-earn:\${job.id}\`} />

// Bounty card (D19)
<BountyPill detail="17h" glint />`;

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className={styles.section} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className={styles.sectionTitle}>
        {title}
      </h2>
      {children}
    </section>
  );
}
