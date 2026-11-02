import { BoltMark } from "@/components/BoltMark";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { TextLink } from "@/components/TextLink";
import { BoltFlash } from "@/components/motion/BoltFlash";

import cards from "@/components/cards/cards.module.css";
import landing from "./landing.module.css";
import styles from "./trust.module.css";

/**
 * A06 / w-trust. Wording is the mockup's, cut back to what DECISIONS.md and the published help articles support
 * (#214: "every claim must be true on launch day"). Each promise links to the help article that explains it (#419).
 * No prices, numbers, insurance or guarantees: none are decided.
 */
export const PROMISES = [
  { icon: "badge", title: "Licences checked by hand", slug: "how-do-you-check-workers", text: "Licensed workers have their licence checked by hand before they can take licensed work. Everyone else joins with photo ID, and checked workers get a verified badge." },
  { icon: "description", title: "Paperwork every time", slug: "electrical-work-and-your-coc", text: "Electrical jobs that need one come with a Certificate of Compliance. Other trades: photos and sign-off." },
  { icon: "lock", title: "Secure payments", slug: "paying-safely", text: "You pay through us. Tradies are paid after you’ve checked the job." },
  { icon: "photo_camera", title: "No surprise bills", slug: "extra-work", text: "Any extra work comes with photos and a price. Nothing happens until you say yes." },
  { icon: "support_agent", title: "Real people", slug: "something-is-not-right", text: "Something not right? Tell us. We pause the sign-off and sort it out." },
  { icon: "star", title: "Honest reviews", slug: "leaving-a-review", text: "Only customers who had a job done can review." },
] as const;

/** A06 has one static state; the only motion is M01 on entry and the M10 bolt flash, once. */
export function TrustPage() {
  return <>
    <section className={`${landing.wrap} ${styles.hero} tm-anim-rise`} aria-labelledby="trust-title">
      <div>
        <p className={styles.eyebrow}>Trust &amp; safety</p>
        <h1 id="trust-title" className={styles.title}>Your home.<br />Done right.</h1>
        <p className={styles.lead}>Here’s exactly what we check and what happens if something goes wrong.</p>
      </div>
      <div className={styles.art} aria-hidden="true">
        <BoltMark variant="hero" className={styles.bolt} />
        <BoltFlash eventId="trust-and-safety" icon="verified_user" size={120} className={styles.flash} />
      </div>
    </section>
    <section className={`${landing.wrap} ${styles.promises}`} aria-label="Our promises">
      <ul className="tm-stagger">
        {PROMISES.map(({ icon, title, slug, text }) => <li key={slug} className={`${styles.card} tm-lift`}>
          <span className={styles.icon}><Icon name={icon} fill decorative /></span>
          <h2><TextLink href={`/help/${slug}`} className={cards.stretched}>{title}</TextLink></h2>
          <p>{text}</p>
          <span className={styles.more}><Icon name="arrow_forward" decorative /></span>
        </li>)}
      </ul>
    </section>
    <section className={`${landing.wrap} ${styles.contact}`} aria-labelledby="trust-questions">
      <h2 id="trust-questions">Questions?</h2>
      <TextLink href="/contact">Contact us<Icon name="arrow_forward" decorative /></TextLink>
    </section>
    <section className={landing.final} aria-labelledby="trust-start"><div className={landing.wrap}>
      <h2 id="trust-start">Got a job that needs doing?</h2>
      <p className={styles.finalText}>Any kind of job, in Invercargill.</p>
      <Button href="/jobs/new" variant="hero" className={styles.cta}>Post a job</Button>
    </div></section>
  </>;
}
