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

import { TRADIE_SIGNUP_PATH } from "./site-links";
import layout from "./for-tradies.module.css";
import site from "./landing.module.css";

const REASONS = [
  ["sell", "Priced before you see it"], ["money_off", "No lead fees"],
  ["receipt_long", "We do the admin"], ["schedule", "Work when you want"],
];

export function ForTradiesPage({ data }: { data: TradieData }) {
  const bolt = useRef<HTMLDivElement>(null);
  const reveal = useOncePerEvent(data.status === "loading" ? null : "for-tradies-headline", "visit");
  useParallax(bolt);
  return <div data-mode="trade">
    <section className={layout.hero} data-site-hero>
      <div ref={bolt} className={`${layout.bolt} tm-parallax`}><BoltMark variant="hero" /></div>
      <div className={layout.heroContent}>
        <h1 className={layout.headline}>{["You do the work.", "We find the jobs."].map((line, i) => <span key={line} className={reveal ? "tm-anim-reveal" : undefined} style={staggerStyle(i)}>{line}{i === 0 ? " " : ""}</span>)}</h1>
        <div className={layout.actions}><Button href={TRADIE_SIGNUP_PATH} variant="hero">Join as a tradie</Button><Button href="#how-it-works" variant="secondary">How it works</Button></div>
      </div>
      {data.status === "ready" && <aside className={layout.illustration} aria-label="Earnings example"><h2 className={layout.exampleTitle}>Earnings example</h2><div className="tm-hero-float">{data.earnings.map((earning) => <JobRow key={earning.trade} href="#earnings" title={earning.trade === "ELECTRICAL" ? "Sub wiring" : "Other / general labour"} price={`Earn ${formatCents(earning.exampleCents)}`} photo={earning.trade === "ELECTRICAL" ? "/images/examples/large/wires.jpg" : "/images/examples/large/house.jpg"} headingLevel={3} className={layout.art} />)}</div><div className={layout.toast}><Icon name="bolt" fill decorative /><b>It’s yours.</b></div></aside>}
    </section>
    <section className={`${site.wrap} ${layout.reasons}`} aria-label="Why join">{REASONS.map(([icon, title]) => <article key={title}><span className={layout.reasonIcon}><Icon name={icon} fill decorative /></span><h2>{title}</h2></article>)}</section>
    <section className={`${site.wrap} ${layout.requirements}`} aria-labelledby="requirements-title"><div className={layout.requirementsCard}>
      <h2 id="requirements-title">What you’ll need</h2>
      <ul>{SIGNUP_TRADES.map((trade) => <li key={trade.value}><Icon name="check_circle" fill decorative /><span>{trade.label}: {trade.licence ? trade.licence.label : "photo ID"}</span></li>)}{["NZ bank account and IRD number", "A phone with the web app", "Your own tools and transport"].map((text) => <li key={text}><Icon name="check_circle" fill decorative /><span>{text}</span></li>)}</ul>
    </div></section>
    <section id="how-it-works" className={`${site.wrap} ${layout.steps}`} aria-labelledby="steps-title"><h2 id="steps-title">How it works</h2><ol>{["Pick any job in Invercargill", "Book a time", "Do the work", "Get paid"].map((step) => <li key={step}>{step}</li>)}</ol></section>
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
    <section className={site.final}><div className={site.wrap}><Button href={TRADIE_SIGNUP_PATH} variant="hero">Join as a tradie</Button></div></section>
  </div>;
}
