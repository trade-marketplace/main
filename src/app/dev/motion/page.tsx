// /dev/motion: every named animation (M01–M27) with a button that plays it, for checking against the Motion
// table in docs/design/WEBAPP_SPEC.md. Development only: in a production build this page is a 404.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BoltMark } from "@/components/BoltMark";
import { MOTION } from "@/lib/motion/catalogue";
import { DEFAULT_MODE, isMode, MODES, type Mode } from "@/lib/mode";

import { MotionShowcase, ReducedMotionStatus } from "./MotionShowcase";
import styles from "./motion.module.css";

export const metadata: Metadata = {
  title: "Motion (dev)",
  robots: { index: false, follow: false },
};

const MODE_NAMES: Record<Mode, string> = { customer: "Customer", trade: "Trade", office: "Office" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function MotionPage({ searchParams }: { searchParams: SearchParams }) {
  if (process.env.NODE_ENV === "production") notFound();

  const params = await searchParams;
  const mode: Mode = isMode(params.mode) ? params.mode : DEFAULT_MODE;

  return (
    <div className={styles.page} data-mode={mode}>
      <header className={styles.band}>
        <BoltMark variant="hero" className={styles.bandBolt} />
        <div className={styles.wrap}>
          <p className={styles.eyebrow}>Dev only · not in production builds</p>
          <h1 className={styles.title}>Motion</h1>
          <p className={styles.lede}>
            The named animations M01–M27 from the Motion table, each built once in <code>src/styles/motion.css</code>{" "}
            and <code>src/lib/motion</code>. Press a button to play one. Turn on “Reduce motion” in your system (or in
            DevTools › Rendering) to see every one become an instant change.
          </p>
          <nav aria-label="Mode" className={styles.modeNav}>
            {MODES.map((m) => (
              <Link
                key={m}
                href={m === DEFAULT_MODE ? "/dev/motion" : `/dev/motion?mode=${m}`}
                aria-current={m === mode ? "page" : undefined}
                className={styles.modeLink}
              >
                {MODE_NAMES[m]}
              </Link>
            ))}
          </nav>
          <ReducedMotionStatus />
        </div>
      </header>

      <main className={styles.wrap}>
        <nav aria-label="Animations" className={styles.toc}>
          {MOTION.map((entry) => (
            <a key={entry.id} href={`#${entry.id.toLowerCase()}`}>
              {entry.id} {entry.name}
            </a>
          ))}
        </nav>
        <MotionShowcase entries={MOTION} />
      </main>
    </div>
  );
}
