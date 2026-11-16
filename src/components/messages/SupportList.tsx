"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { Pill } from "@/components/status/Pill";
import { Icon } from "@/components/Icon";
import { TextLink } from "@/components/TextLink";
import { EmptyState, ErrorState, OfflineBanner, SkeletonText, useOnlineStatus } from "@/components/feedback";
import { modeForRole, type Role } from "@/lib/mode";
import type { SupportInbox, SupportSummary } from "@/lib/support";
import { supportThreadHref } from "@/lib/support-return";
import styles from "./support-start.module.css";
export type SupportListData = Pick<SupportInbox, "page" | "pages"> & { threads: Pick<SupportSummary, "id" | "subject" | "when" | "unread">[] };
export function SupportList({ role, data, replied = {}, loading = false, preview = false }: { role?: Role; data: SupportListData | null; replied?: Record<string, boolean>; loading?: boolean; preview?: boolean }) {
  const router = useRouter(), online = useOnlineStatus(), empty = data?.threads.length === 0, back = data && data.page > 1 ? `/support?page=${data.page}` : "/support";
  const start = preview ? "/dev/components/support-start?state=form" : `/support/new?returnTo=${encodeURIComponent(back)}`;
  return <section className={styles.page} data-mode={role ? modeForRole(role) : undefined}>
    <TextLink href="/help">Help</TextLink><header className={styles.listHeader}><h1>Your messages</h1>{!empty && <Button href={start} width="auto">Message us</Button>}</header>
    <OfflineBanner online={online} sticky={false} />
    <div className={styles.card}>{loading ? <div role="status" aria-label="Loading messages"><SkeletonText lines={5} /></div> : !data ? <ErrorState title="Can’t load messages." onRetry={() => router.refresh()} /> : empty ? <EmptyState icon="chat_bubble" title="No messages yet." action={<Button href={start} width="auto">Message us</Button>} /> : <>
      <ul className={styles.list}>{data.threads.map(thread => <li key={thread.id}><Link className={styles.thread} href={preview ? "/dev/components/support-start?state=list-replied" : supportThreadHref(thread.id, back)}>
        <span className={styles.subject}>{thread.unread && <span className={styles.dot}><span className={styles.srOnly}>Unread: </span></span>}{thread.subject}</span>
        {replied[thread.id] && <Pill kind="good">Replied</Pill>}<span className={styles.when}>{thread.when}</span><Icon name="chevron_right" decorative />
      </Link></li>)}</ul>
      {data.pages > 1 && <nav className={styles.pages} aria-label="Your messages pages">{data.page > 1 && <TextLink href={`/support?page=${data.page - 1}`}>Previous</TextLink>}<span>Page {data.page} of {data.pages}</span>{data.page < data.pages && <TextLink href={`/support?page=${data.page + 1}`}>Next</TextLink>}</nav>}
    </>}</div>
  </section>;
}
