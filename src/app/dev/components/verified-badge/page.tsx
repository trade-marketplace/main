import type { Metadata } from "next";
import Link from "next/link";
import { AppShellView } from "@/components/app/AppShellView";
import { ProfileCard } from "@/components/cards/ProfileCard";
import { WorkerCard } from "@/components/cards/WorkerCard";
import { guardDevPage } from "@/server/dev-pages";
import { isVerified } from "@/server/workers/verification";
import { PREVIEW_NOW, VERIFIED_STATES, verificationExample } from "./preview-data";
import styles from "./preview.module.css";

export const metadata: Metadata = { title: "Verified badge (dev)", robots: { index: false, follow: false } };
export default async function VerifiedBadgePreview({ searchParams }: { searchParams: Promise<{ state?: string; view?: string }> }) {
  guardDevPage();
  const params = await searchParams;
  const state = VERIFIED_STATES.find(value => value === params.state) ?? "verified";
  const { worker, trade } = verificationExample(state);
  const verification = { verified: isVerified(worker, trade, PREVIEW_NOW), trade };
  const meta = trade === "OTHER" ? "Other · Invercargill" : trade === "PLUMBING" ? "Plumber · Invercargill" : "Electrician · Invercargill";
  return <AppShellView viewer={{ role: "TRADIE", firstName: "Jack", lastName: "Wilson", email: "worker@demo.test", counts: { messages: 0, notifications: 0 } }} testMode preview={{ at: "/profile", base: `/dev/components/verified-badge?state=${state}` }}>
    <div className={styles.surface}><div className={styles.page}><h1>Verified badge</h1><p className={styles.note}>Development preview · example data</p>
      <nav className={styles.states} aria-label="Verification state">{VERIFIED_STATES.map(value => <Link key={value} href={`?state=${value}`} aria-current={value === state ? "page" : undefined}>{value.replaceAll("-", " ")}</Link>)}</nav>
      <div className={styles.grid}>
        <section aria-label="Worker tile"><h2>Worker tile</h2><WorkerCard name="Jack W." meta={meta} verification={verification} href={`?state=${state}&view=profile#profile`} /></section>
        <section id="profile" aria-label="Profile"><h2>Profile</h2><ProfileCard name="Jack W." meta={meta} verification={verification} headingLevel={3} variant="card" stats={[{ label: "rating", value: "4.9" }, { label: "jobs", value: "32" }, { label: "joined", value: "2024" }]} /></section>
        <section aria-label="Booked panel"><h2>Your tradie</h2><WorkerCard name="Jack W." meta={meta} verification={verification} /></section>
      </div>
    </div></div>
  </AppShellView>;
}
