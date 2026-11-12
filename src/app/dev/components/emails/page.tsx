import type { Metadata } from "next";

import { TextLink } from "@/components/TextLink";
import { SITE_URL } from "@/lib/metadata";
import { guardDevPage } from "@/server/dev-pages";
import { notificationEmail } from "@/server/notifications/email-templates";

import styles from "./preview.module.css";

export const metadata: Metadata = { title: "Emails (dev)", robots: { index: false, follow: false } };
const choices = { "price-ready": "Price ready", "please-check": "Please check", "licence-checked": "Licence checked" } as const;
const job = { to: "customer@example.test", jobId: "11000000-0000-4000-8000-000000000001", jobNumber: 1005, title: "Sub wiring" };

export default async function EmailsPreview({ searchParams }: { searchParams: Promise<{ template?: string }> }) {
  guardDevPage();
  const { template } = await searchParams;
  const selected = template && Object.hasOwn(choices, template) ? template as keyof typeof choices : "price-ready";
  const email = selected === "price-ready" ? notificationEmail("job.priced", { ...job, priceCents: 37200 })
    : selected === "please-check" ? notificationEmail("job.submitted", { ...job, firstName: "Jack", autoReleaseHours: 48 })
      : notificationEmail("licence.verified", { to: "tradie@example.test", trade: "ELECTRICAL" });
  // Local copies of the same assets keep the guarded preview independent of public hosting availability.
  const html = email.html.replaceAll(`${SITE_URL.origin}/fonts/`, "/fonts/").replaceAll(`${SITE_URL.origin}/icons/`, "/icons/");
  return <main className={styles.page} aria-labelledby="email-preview-title">
    <h1 id="email-preview-title" className={styles.title}>Emails</h1>
    <nav aria-label="Emails" className={styles.links}>{Object.entries(choices).map(([value, label]) => <TextLink key={value} href={`/dev/components/emails?template=${value}`} aria-current={selected === value ? "page" : undefined}>{label}</TextLink>)}</nav>
    <iframe title={email.subject} srcDoc={html} width="600" height="680" className={styles.frame} />
  </main>;
}
