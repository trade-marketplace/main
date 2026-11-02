"use client";

import Image from "next/image";
import { type ReactNode, useRef } from "react";

import { BoltMark } from "@/components/BoltMark";
import { Button, buttonClasses } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { TextLink } from "@/components/TextLink";
import { TextField } from "@/components/forms/TextFields";
import { Avatar } from "@/components/media/Avatar";
import { StarRating } from "@/components/media/Stars";
import { Pill } from "@/components/status/Pill";
import { useInViewOnce } from "@/lib/motion/hooks";

import cards from "@/components/cards/cards.module.css";
import price from "@/components/status/status.module.css";
import hero from "./hero.module.css";
import landing from "./landing.module.css";
import styles from "./how-it-works.module.css";

const ESSENTIALS = [
  ["edit_note", "Free to post", "Getting a price costs nothing, and there’s no obligation to go ahead."],
  ["sell", "One fixed price", "The price you accept is the price you pay. If the job turns out bigger, you see photos and the extra cost first, and it only goes ahead if you say yes."],
  ["verified", "Checked people", "Licensed work is done by people whose licences we’ve checked. Everyone else joins with photo ID and is rated by people near you."],
] as const;
/** Each links to its help article (#419), so the answer is one click away. */
const QUESTIONS = [
  ["Is it really free to post?", "is-it-free"],
  ["Who will do my job?", "who-will-do-my-job"],
  ["What if the job needs more work?", "extra-work"],
] as const;

/** A02 has one static state: no quote, worker, payment or network request is simulated. */
export function HowItWorks() {
  return <>
    <section className={`${hero.hero} ${hero.short}`} data-site-hero>
      <BoltMark variant="hero" className={styles.bolt} />
      <div className={`${landing.wrap} ${styles.heroText}`}><h1 className={hero.title}>How it works</h1><p className={hero.lead}>Three steps. We make the hard calls for you.</p></div>
    </section>
    <ol className={`${landing.wrap} ${styles.steps}`} aria-label="How it works">
      <Step number={1} title="Post it" text="Say what needs doing and add a photo or two. It’s free and takes about two minutes. No account needed to start.">
        <div className={`${cards.kpi} ${styles.mini} tm-lift`} aria-hidden="true"><div inert>
          <TextField label="Job description" labelHidden readOnly tabIndex={-1} value="Lights in the lounge keep flickering…" className={styles.description} />
          <div className={styles.photos}>{["wires", "switch"].map((name) => <Image key={name} src={`/images/examples/large/${name}.jpg`} alt="" width={64} height={64} sizes="64px" />)}</div>
        </div></div>
      </Step>
      <Step number={2} title="Accept the price" text="You get one fixed price. Happy? Accept and pay. Not? Say no. It costs nothing.">
        <div className={`${cards.kpi} ${styles.mini} tm-lift`} aria-hidden="true"><div inert>
          <div className={price.pricebox}><BoltMark variant="hero" className={price.priceBolt} /><div className={price.priceRow}><div className={price.priceMain}><span className={price.priceCap}>Your price</span><span className={price.price}>$372.00</span></div></div></div>
          <span className={`${buttonClasses({ variant: "hero", width: "full" })} ${styles.accept}`}>Accept &amp; pay</span>
        </div></div>
      </Step>
      <Step number={3} title="Sorted" text="A checked, local worker takes the job and gets it done. You check it and rate them.">
        <div className={`${cards.kpi} ${styles.mini} tm-lift`} aria-hidden="true"><div inert>
          <div className={styles.worker}><Avatar name="Jack Wilson" decorative /><div><b>Jack Wilson</b><StarRating value={5} size="sm" showValue={false} /></div></div>
          <div className={styles.sorted}><Pill kind="done">Sorted</Pill></div>
        </div></div>
      </Step>
    </ol>
    <section className={`${landing.wrap} ${styles.essentials}`} aria-label="What's included">
      <ul>{ESSENTIALS.map(([icon, label, text]) => <li key={label}><span className={styles.essentialIcon}><Icon name={icon} fill decorative /></span><div><h2>{label}</h2><p>{text}</p></div></li>)}</ul>
    </section>
    <section className={`${landing.wrap} ${landing.questions}`} aria-labelledby="how-questions">
      <h2 id="how-questions">Questions?</h2>
      <ul className={styles.questions}>{QUESTIONS.map(([question, slug]) => <li key={question}><TextLink href={`/help/${slug}`}>{question}<Icon name="arrow_forward" decorative /></TextLink></li>)}</ul>
    </section>
    <section className={landing.final} aria-labelledby="how-start"><div className={landing.wrap}>
      <h2 id="how-start">Got a job that needs doing?</h2>
      <Button href="/jobs/new" variant="hero" className={styles.cta}>Post a job</Button>
    </div></section>
  </>;
}

function Step({ number, title, text, children }: { number: number; title: string; text: string; children: ReactNode }) {
  const ref = useRef<HTMLLIElement>(null);
  const seen = useInViewOnce(ref);
  return <li ref={ref} className={`${styles.step}${seen ? " tm-anim-rise" : ""}`}>
    <span className={styles.number} aria-hidden="true">{number}</span>
    <div><h2>{title}</h2><p className={styles.stepText}>{text}</p></div>
    {children}
  </li>;
}
