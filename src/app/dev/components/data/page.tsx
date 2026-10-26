import type { Metadata } from "next";
import Link from "next/link";

import { BoltMark } from "@/components/BoltMark";
import { isMode, MODES } from "@/lib/mode";
import { guardDevPage } from "@/server/dev-pages";

import { DataDemos } from "./DataDemos";
import { PREVIEW_STATES, type PreviewState } from "./demo-data";
import styles from "./preview.module.css";

export const metadata: Metadata = { title: "Tables, tabs & filters (dev)", robots: { index: false, follow: false } };

export default async function DataPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  guardDevPage();
  const params = await searchParams;
  const mode = isMode(params.mode) ? params.mode : "office";
  const state = PREVIEW_STATES.includes(params.state as PreviewState) ? params.state as PreviewState : "default";
  return <div data-mode={mode} className={styles.page}>
    <header className={styles.band}><BoltMark variant="hero" className={styles.bolt} /><div className={styles.wrap}>
      <p className={styles.eyebrow}>Design system · issue #80 · dev only</p>
      <h1>Tables, tabs & filters</h1>
      <p className={styles.lede}>A clear view of the work. Find a job, change your view, and keep the details together.</p>
      <nav aria-label="Mode" className={styles.modeNav}>{MODES.map((item) => <Link key={item}
        href={`/dev/components/data?mode=${item}&state=${state}`} aria-current={mode === item ? "page" : undefined}>
        {item === "trade" ? "Tradie" : item === "office" ? "Office" : "Customer"}</Link>)}</nav>
    </div></header>
    <main className={styles.wrap}>
      <nav aria-label="Sections" className={styles.toc}><a href="#tabs">Tabs & segments</a><a href="#usage">Working example</a><a href="#long">Long labels</a></nav>
      <DataDemos key={state} initialState={state} />
    </main>
  </div>;
}
