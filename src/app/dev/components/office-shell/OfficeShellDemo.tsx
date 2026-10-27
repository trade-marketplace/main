import Link from "next/link";

import { OfficeShellView, type OfficeShellViewer } from "@/components/office/OfficeShellView";
import { OFFICE_NAV, type OfficeCounts } from "@/components/office/office-links";

import styles from "./office-shell.module.css";

const BASE = "/dev/components/office-shell";
const NONE: OfficeCounts = { queues: 0, jobs: 0, tradies: 0, customers: 0, payouts: 0, payments: 0, reviews: 0, support: 0, settings: 0 };
const COUNTS: Record<string, OfficeCounts> = {
  none: NONE,
  some: { ...NONE, queues: 9, tradies: 3, support: 2 },
  many: { ...NONE, queues: 135, tradies: 104, payouts: 101, support: 120 },
};

type Props = { counts: "none" | "some" | "many"; at: string; menuOpen: boolean; accountOpen: boolean; testMode: boolean; longName: boolean };

export function OfficeShellDemo(props: Props) {
  const { counts, at, menuOpen, accountOpen, testMode, longName } = props;
  const params = new URLSearchParams({ counts, at, test: testMode ? "on" : "off", name: longName ? "long" : "short" });
  const href = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    next.set(key, value);
    return `${BASE}?${next}`;
  };
  const viewer: OfficeShellViewer = {
    role: "ADMIN", firstName: longName ? "Alexandria-Anahera" : "Matt",
    lastName: longName ? "Te Aho-Williams-Montgomery" : "Larsen",
    email: longName ? "alexandria.anahera.teaho.williams.montgomery@demo.test" : "office@demo.test",
    counts: COUNTS[counts],
  };
  return (
    <OfficeShellView viewer={viewer} testMode={testMode} preview={{ at, base: `${BASE}?${params}`, menuOpen, accountOpen }}>
      <div className={styles.content}>
        <h1 className={styles.title}>Office shell</h1>
        <p className={styles.lede}>Navigation preview · example names and counts</p>
        <div className={styles.panel}>
          <h2>Page content goes here</h2>
          <p>The office pages use this frame. Choose a link to check its current state.</p>
          <p>Current page: <code>{at}</code></p>
        </div>
        <section aria-label="Preview states" className={styles.controls}>
          <h2>Preview states</h2>
          <nav aria-label="Count examples"><span>Counts</span>{["none", "some", "many"].map((value) => <Link key={value} href={href("counts", value)} aria-current={counts === value ? "true" : undefined}>{value === "many" ? "99+" : value}</Link>)}</nav>
          <nav aria-label="Test mode examples"><span>Test mode</span><Link href={href("test", "on")}>On</Link><Link href={href("test", "off")}>Off</Link></nav>
          <nav aria-label="Menu examples"><span>Menus</span><Link href={href("menu", "open")}>Office menu open</Link><Link href={href("account", "open")}>Account menu open</Link></nav>
          <nav aria-label="Name examples"><span>Name</span><Link href={href("name", "short")}>Short</Link><Link href={href("name", "long")}>Long</Link></nav>
          <nav aria-label="Page examples"><span>Current page</span>{OFFICE_NAV.map((link) => <Link key={link.key} href={href("at", link.href)}>{link.label}</Link>)}</nav>
        </section>
      </div>
    </OfficeShellView>
  );
}
