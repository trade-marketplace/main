// Placeholder until the real home page (#211). Uses the tokens and fonts from #72. It sits in the site shell
// ((site)/layout.tsx, #83); `data-site-hero` makes the header transparent over the band until it scrolls past (M06).
import { BoltMark } from "@/components/BoltMark";

import styles from "./page.module.css";

export default function Home() {
  return (
    <section className={styles.band} data-site-hero>
      <BoltMark variant="hero" className={styles.bolt} />
      <div className={styles.wrap}>
        <BoltMark className={styles.mark} />
        <h1 className={styles.wordmark}>Trade Marketplace</h1>
        <p className={styles.line}>Sorted in a flash. The app is being built; launching in Invercargill.</p>
      </div>
    </section>
  );
}
