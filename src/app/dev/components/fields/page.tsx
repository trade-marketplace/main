import type { Metadata } from "next";
import Link from "next/link";

import { BoltMark } from "@/components/BoltMark";
import { DEFAULT_MODE, isMode, MODES } from "@/lib/mode";
import { guardDevPage } from "@/server/dev-pages";

import { FieldDemos, type PreviewState } from "./FieldDemos";
import styles from "./fields.module.css";

export const metadata: Metadata = { title: "Form fields (dev)", robots: { index: false, follow: false } };

export default async function FieldsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  guardDevPage();
  const params = await searchParams;
  const mode = isMode(params.mode) ? params.mode : DEFAULT_MODE;
  const state: PreviewState = params.state === "error" || params.state === "disabled" || params.state === "success" ? params.state : "default";
  return <div className={styles.page} data-mode={mode}>
    <header className={styles.band}>
      <BoltMark variant="hero" className={styles.bolt} />
      <div className={styles.wrap}>
        <p className={styles.eyebrow}>Design system · issue #75 · dev only</p>
        <h1 className={styles.title}>Form fields</h1>
        <p className={styles.lede}>From the first hello to a time that suits. Try the fields, pick a palette, and see what happens when a form needs another look.</p>
        <nav aria-label="Mode" className={styles.modeNav}>
          {MODES.map((item) => <Link key={item} href={`/dev/components/fields?mode=${item}&state=${state}`}
            aria-current={mode === item ? "page" : undefined}>{item === "trade" ? "Tradie" : item === "office" ? "Office" : "Customer"}</Link>)}
        </nav>
      </div>
    </header>
    <main className={styles.wrap}>
      <nav aria-label="Sections" className={styles.toc}>
        <a href="#text">Text & numbers</a><a href="#choices">Choices</a><a href="#booking">Dates & times</a>
        <a href="#address">Addresses</a><a href="#edge-cases">Long content</a><a href="#usage">Try a form</a>
      </nav>
      <FieldDemos initialState={state} />
    </main>
  </div>;
}
