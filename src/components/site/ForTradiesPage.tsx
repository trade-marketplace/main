"use client";

import { useRef } from "react";

import { BoltMark } from "@/components/BoltMark";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { EmptyCard } from "@/components/cards/EmptyCard";
import { JobRow } from "@/components/cards/JobRow";
import { ErrorState, LoadingRegion, Skeleton } from "@/components/feedback";
import { PriceBlock, formatCents } from "@/components/status/PriceBlock";
import { SIGNUP_TRADES } from "@/lib/auth/worker-signup";
import { staggerStyle } from "@/lib/motion/helpers";
import { useOncePerEvent, useParallax } from "@/lib/motion/hooks";
import type { TradieData } from "@/server/for-tradies";

import { TRADIE_SIGNUP_PATH, WORKER_JOIN_LABEL } from "./site-links";
import layout from "./for-tradies.module.css";
import hero from "./hero.module.css";
import site from "./landing.module.css";

const REASONS = [
  ["sell", "Priced before you see it", "Every job shows what you earn. No quoting at 9pm."],
  ["money_off", "No lead fees", "Never pay to see a job. Never race to the bottom."],
  ["receipt_long", "We do the admin", "Invoices, payments, payroll. Materials through Telfer."],
  ["schedule", "Work when you want", "Fill a free Saturday or go full-time."],
];
/** Worker steps (#419). Step 4's sentence waits for William to confirm payment timing, so it is a title only for now:
 *  "Once the customer signs it off (or 48 hours after you finish, if they don't), you get paid." */
const STEPS: { title: string; text?: string }[] = [
  { title: "Pick a job", text: "Browse jobs near you. Each one shows what you earn before you take it." },
  { title: "Book a time", text: "Message the customer through the app and lock in a time that suits you both." },
  { title: "Do the work", text: "Turn up, do a good job, and add photos when you’re done. Extra work? Send photos and the cost through the app first." },
  { title: "Get paid" },
];

export function ForTradiesPage({ data }: { data: TradieData }) {
  const bolt = useRef<HTMLDivElement>(null);
  const reveal = useOncePerEvent(data.status === "loading" ? null : "for-tradies-headline", "visit");
  useParallax(bolt);
  return <div data-mode="trade">
    <section className={`${hero.hero} ${hero.tall} ${layout.hero}`} data-site-hero>
      <div ref={bolt} className={`${layout.bolt} tm-parallax`}><BoltMark variant="hero" /></div>
      <div className={layout.heroContent}>
        <h1 className={`${hero.title} ${layout.headline}`}>{["You do the work.", "We find the jobs."].map((line, i) => <span key={line} className={reveal ? "tm-anim-reveal" : undefined} style={staggerStyle(i)}>{line}{i === 0 ? " " : ""}</span>)}</h1>
        <p className={hero.lead}>Local jobs, already priced and paid. No lead fees. No chasing invoices.</p>
        <div className={hero.actions}><Button href={TRADIE_SIGNUP_PATH} variant="hero" width="auto">{WORKER_JOIN_LABEL}</Button><Button href="#how-it-works" variant="secondary" width="auto" className={hero.ghost}>How it works</Button></div>
      </div>
      {data.status === "ready" && <aside className={layout.illustration} aria-label="Earnings example"><h2 className={layout.exampleTitle}>Earnings example</h2><div className={`tm-hero-float ${layout.floats}`}>{data.earnings.map((earning) => <JobRow key={earning.trade} href="#earnings" title={earning.trade === "ELECTRICAL" ? "Sub wiring" : "Other / general labour"} price={`Earn ${formatCents(earning.exampleCents)}`} photo={earning.trade === "ELECTRICAL" ? "/images/examples/large/wires.jpg" : "/images/examples/large/house.jpg"} headingLevel={3} className={layout.art} />)}</div><div className={layout.toast}><Icon name="bolt" fill decorative /><b>It’s yours.</b></div></aside>}
    </section>
    <section className={`${site.wrap} ${layout.reasons}`} aria-label="Why join">{REASONS.map(([icon, title, text]) => <article key={title}><span className={layout.reasonIcon}><Icon name={icon} fill decorative /></span><h2>{title}</h2><p>{text}</p></article>)}</section>
    <section className={`${site.wrap} ${layout.requirements}`} aria-labelledby="requirements-title"><div className={layout.requirementsCard}>
      <div><h2 id="requirements-title">What you’ll need</h2><p>We check by hand, usually within one working day.</p></div>
      <ul>{SIGNUP_TRADES.map((trade) => <li key={trade.value}><Icon name="check_circle" fill decorative /><span>{trade.label}: {trade.licence ? trade.licence.label : "photo ID"}</span></li>)}{["NZ bank account and IRD number", "A phone with the web app (works in any browser)", "Your own tools and transport"].map((text) => <li key={text}><Icon name="check_circle" fill decorative /><span>{text}</span></li>)}</ul>
    </div></section>
    <section id="how-it-works" className={`${site.wrap} ${layout.steps}`} aria-labelledby="steps-title"><h2 id="steps-title">How it works</h2><ol>{STEPS.map((step, i) => <li key={step.title}><span className={layout.stepNumber} aria-hidden="true">{i + 1}</span><h3>{step.title}</h3>{step.text && <p>{step.text}</p>}</li>)}</ol></section>
    <section id="earnings" className={`${site.wrap} ${layout.earnings}`} aria-labelledby="earnings-title"><h2 id="earnings-title">Earnings example</h2>
      {data.status === "ready" ? <div className={layout.earningGrid}>{data.earnings.map((earning) => <article key={earning.trade}><h3>{SIGNUP_TRADES.find((trade) => trade.value === earning.trade)!.label}</h3><PriceBlock audience="tradie" earnCents={earning.exampleCents} breakdown={{ minutes: earning.minutes, rateCents: earning.rateCents, holidayPay: earning.holidayPay }} /><p>{`Earn ${formatCents(earning.hourlyCents)}/hr`}</p></article>)}</div>
        : data.status === "loading" ? <LoadingRegion loading label="Loading earnings" skeleton={<Skeleton height={180} />} />
        : data.status === "error" ? <ErrorState headingLevel={3} title="Rates unavailable" onRetry={() => window.location.reload()} />
        : <EmptyCard icon="payments" title="Rates unavailable" />}
    </section>
    <section className={`${site.wrap} ${layout.faq}`} aria-labelledby="faq-title"><h2 id="faq-title">Questions?</h2><div>
      <details><summary>Any job?</summary><p>Yes. Other work needs photo ID. Restricted work needs a current licence.</p></details>
      <details><summary>Lead fees?</summary><p>None.</p></details>
    </div></section>
    <section className={site.final}><div className={site.wrap}><Button href={TRADIE_SIGNUP_PATH} variant="hero">{WORKER_JOIN_LABEL}</Button></div></section>
  </div>;
}
