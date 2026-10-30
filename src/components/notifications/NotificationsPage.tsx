"use client";

import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { useOptionalSessionExpired } from "@/components/auth/SessionExpired";
import { Pagination, Tabs } from "@/components/data";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { useOnlineStatus } from "@/components/feedback/OfflineBanner";
import { LoadingRegion } from "@/components/feedback/LoadingRegion";
import { Skeleton } from "@/components/feedback/Skeleton";
import { Banner } from "@/components/overlays/Banner";
import { loginPath } from "@/lib/auth/routes";
import { NOTIFICATIONS_PAGE_SIZE, notificationDays, notificationsHref, notificationTime, type InboxItem, type NotificationsQuery, type NotificationsResult, type NotificationsSource } from "@/lib/notifications";
import { loadNotificationsPageAction, readNotificationsPageAction } from "@/server/notifications/actions";

import { useNotificationInboxRefresh } from "./NotificationInbox";
import styles from "./notifications.module.css";

const SOURCE: NotificationsSource = { load: loadNotificationsPageAction, read: readNotificationsPageAction };
const clock = new Intl.DateTimeFormat("en-NZ", { hour: "numeric", minute: "2-digit", timeZone: "Pacific/Auckland" });

export function NotificationsLoading() {
  return <div className={styles.page}><div className={`${styles.pageContent} tm-anim-rise`}>
    <h1 className={styles.pageTitle}>Notifications</h1><LoadingRegion loading label="Loading notifications" skeleton={<NotificationsSkeleton />} />
  </div></div>;
}

function NotificationsSkeleton() {
  return <div className={styles.loading}>
    {[0, 1, 2, 3].map((i) => <div key={i} className={styles.loadingRow}><Skeleton width={36} height={36} /><div><Skeleton width="80%" /><Skeleton width={50} height={12} /></div></div>)}
  </div>;
}

export function NotificationsPage({ initial, query, source = SOURCE, now: fixedNow, baseHref = "/notifications", extraQuery = "", loading = false, online: forcedOnline }: {
  initial: NotificationsResult; query: NotificationsQuery; source?: NotificationsSource; now?: number; baseHref?: string; extraQuery?: string; loading?: boolean; online?: boolean;
}) {
  const router = useRouter();
  const expired = useOptionalSessionExpired();
  const refreshBell = useNotificationInboxRefresh();
  const browserOnline = useOnlineStatus();
  const online = forcedOnline ?? browserOnline;
  const [result, setResult] = useState(initial);
  const [previousInitial, setPreviousInitial] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [now] = useState(fixedNow ?? Date.now);
  const active = useRef(true);
  const pending = useRef(false);
  const generation = useRef(0);
  const content = useRef<HTMLDivElement>(null);
  const wasOnline = useRef(online);
  const reconnect = useEffectEvent(() => { void run(); });
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; generation.current += 1; pending.current = false; };
  }, [query.filter, query.page]);
  useEffect(() => {
    if (online && !wasOnline.current) reconnect();
    wasOnline.current = online;
  }, [online]);
  const inbox = result.ok ? result.inbox : null;
  const href = (next: NotificationsQuery) => notificationsHref(next, baseHref, extraQuery);
  const currentQuery = { ...query, page: inbox?.page ?? query.page };
  // Keep the tab DOM/focus while the server supplies a new URL-selected page (including browser Back).
  if (initial !== previousInitial) {
    setPreviousInitial(initial); setResult(initial); setBusy(false); setSaving(false);
  }

  async function run(id?: string | null, destination?: string) {
    if (pending.current || !online) return;
    pending.current = true; setBusy(true); setSaving(id !== undefined);
    const requestGeneration = generation.current;
    let next: NotificationsResult;
    try { next = id === undefined ? await source.load(currentQuery) : await source.read(id, currentQuery); }
    catch { next = { ok: false, error: "unavailable" }; }
    if (!active.current || requestGeneration !== generation.current) return;
    pending.current = false;
    setBusy(false); setSaving(false);
    if (!next.ok && next.error === "session-expired") {
      if (expired) expired.show({ resend: () => run(id, destination) });
      else router.push(loginPath(href(currentQuery)));
      return;
    }
    setResult(next);
    if (next.ok) {
      void refreshBell?.();
      if (destination) router.push(destination);
      else {
        if (next.inbox.page !== query.page) router.replace(href({ ...query, page: next.inbox.page }));
        requestAnimationFrame(() => { if (active.current) content.current?.querySelector<HTMLElement>('[role="tabpanel"]')?.focus({ preventScroll: true }); });
      }
    }
  }

  function row(item: InboxItem) {
    const time = now - Date.parse(item.createdAt) >= 86_400_000 ? clock.format(new Date(item.createdAt)) : notificationTime(item.createdAt, now);
    return <li key={item.id}>
      <Button id={item.id} variant="tertiary" width="full" className={[styles.pageRow, item.readAt === null && styles.unread].filter(Boolean).join(" ")} disabled={busy || !online}
        onClick={() => { void run(item.id, item.href); }}>
        <span className={styles.pageRowContent}>
          <span className={styles.icon}><Icon name={item.icon} decorative /></span>
          <span className={styles.body}><span className={styles.line}>{item.line}</span><time dateTime={item.createdAt}>{time}</time></span>
          {item.readAt === null && <span className={styles.dot} role="img" aria-label="Unread" />}
          <Icon name="chevron_right" decorative />
        </span>
      </Button>
    </li>;
  }

  return <div className={styles.page}><div className={`${styles.pageContent} tm-anim-rise`} ref={content}>
    {!online && <Banner tone="alert" title="You're offline." />}
    <header className={styles.pageHeading}><h1 className={styles.pageTitle}>Notifications</h1>
      {Boolean(inbox?.unread) && <Button variant="tertiary" width="auto" disabled={busy || loading || !online} onClick={() => { void run(null); }}>Mark all read</Button>}
    </header>
    <Tabs label="Notifications" value={query.filter} onChange={(filter) => router.push(href({ filter, page: 1 }))} items={[{ value: "all", label: "All" }, { value: "unread", label: "Unread" }]}>
      <div aria-busy={busy || loading}>
        <LoadingRegion loading={loading || (busy && !saving)} label="Loading notifications" skeleton={<NotificationsSkeleton />}>
        {!result.ok ? <ErrorState title="Notifications unavailable" onRetry={() => run()} /> : inbox?.items.length === 0 ?
          <EmptyState title={query.filter === "unread" ? "No unread notifications" : "No notifications"} icon="notifications_none" /> :
          notificationDays(inbox?.items ?? [], now).map((day) => <section key={day.key} aria-label={day.label} className={styles.day}>
            <h2 className={styles.dayTitle}>{day.label}</h2><ul className={styles.pageRows}>{day.items.map(row)}</ul>
          </section>)}
        </LoadingRegion>
      </div>
    </Tabs>
    {inbox && inbox.total > NOTIFICATIONS_PAGE_SIZE && !loading && <Pagination page={inbox.page} pageSize={NOTIFICATIONS_PAGE_SIZE} total={inbox.total} label="Notification pages" getHref={(page) => href({ ...query, page })} />}
    <span role="status" className={styles.srOnly}>{saving ? "Marking notifications read" : inbox ? `${inbox.unread} unread notifications` : ""}</span>
  </div></div>;
}
