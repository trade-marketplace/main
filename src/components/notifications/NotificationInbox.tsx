"use client";

import { useRouter } from "next/navigation";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";

import { IconButton } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { NavCount } from "@/components/app/NavCount";
import { countLabel } from "@/components/app/app-links";
import appStyles from "@/components/app/app.module.css";
import { useOptionalSessionExpired } from "@/components/auth/SessionExpired";
import { Skeleton } from "@/components/feedback/Skeleton";
import { Menu, MenuItem } from "@/components/overlays/Menu";
import { loginPath } from "@/lib/auth/routes";
import { type InboxResult, type InboxSnapshot, type InboxSource, notificationTime } from "@/lib/notifications";
import { loadNotificationsAction, readNotificationsAction } from "@/server/notifications/actions";

import styles from "./notifications.module.css";

const SERVER_SOURCE: InboxSource = { load: loadNotificationsAction, read: readNotificationsAction };
const EMPTY_SOURCE: InboxSource = { load: async () => ({ ok: true, inbox: { items: [], unread: 0 } }), read: async () => ({ ok: true, inbox: { items: [], unread: 0 } }) };
type InboxState = { inbox: InboxSnapshot | null; phase: "idle" | "loading" | "ready" | "error"; saving: boolean; countKey: number };
type InboxContextValue = InboxState & { count: number; now: number; refresh: () => Promise<void>; read: (id: string | null) => Promise<boolean> };
const InboxContext = createContext<InboxContextValue | null>(null);

/** The full page refreshes the shared bell after a confirmed read. */
export function useNotificationInboxRefresh() { return useContext(InboxContext)?.refresh; }

type ProviderProps = {
  children: ReactNode; count: number; source?: InboxSource; preview?: boolean; initialInbox?: InboxSnapshot; initialError?: boolean; initialSaving?: boolean; now?: number;
};

export function NotificationInboxProvider(props: ProviderProps) {
  const parent = useContext(InboxContext);
  return parent ? props.children : <InboxStateProvider {...props} />;
}

function InboxStateProvider({ children, count, source, preview = false, initialInbox, initialError = false, initialSaving = false, now: initialNow }: ProviderProps) {
  const api = source ?? (preview ? EMPTY_SOURCE : SERVER_SOURCE);
  const expired = useOptionalSessionExpired();
  const [state, setState] = useState<InboxState>({ inbox: initialInbox ?? null, phase: initialError ? "error" : initialInbox ? "ready" : "idle", saving: initialSaving, countKey: count });
  const [now, setNow] = useState(initialNow ?? Date.now);
  const request = useRef(0);
  const saving = useRef(false);
  const loaded = useRef(Boolean(initialInbox));
  const handleFailure = useCallback((result: InboxResult, retry: () => unknown) => {
    if (result.ok || result.error !== "session-expired") return;
    if (expired) expired.show({ resend: retry });
    else window.location.assign(loginPath(window.location.pathname + window.location.search));
  }, [expired]);

  const refresh = useCallback(async function reload() {
    if (saving.current) return;
    const sequence = ++request.current;
    setState((s) => ({ ...s, phase: s.inbox ? "ready" : "loading" }));
    let result: InboxResult;
    try { result = await api.load(); } catch { result = { ok: false, error: "unavailable" }; }
    if (sequence !== request.current) return;
    loaded.current = true;
    if (result.ok) setState({ inbox: result.inbox, phase: "ready", saving: false, countKey: count });
    else { setState((s) => ({ ...s, phase: "error" })); handleFailure(result, reload); }
    if (initialNow === undefined) setNow(Date.now());
  }, [api, count, handleFailure, initialNow]);

  const read = useCallback(async (id: string | null) => {
    if (saving.current) return false;
    saving.current = true;
    const sequence = ++request.current;
    setState((s) => ({ ...s, saving: true }));
    let result: InboxResult;
    try { result = await api.read(id); } catch { result = { ok: false, error: "unavailable" }; }
    saving.current = false;
    if (sequence !== request.current) return false;
    if (result.ok) setState({ inbox: result.inbox, phase: "ready", saving: false, countKey: count });
    else { setState((s) => ({ ...s, saving: false, phase: "error" })); handleFailure(result, refresh); }
    return result.ok;
  }, [api, count, handleFailure, refresh]);

  useEffect(() => {
    const reload = () => { if (loaded.current && document.visibilityState === "visible") void refresh(); };
    const timer = window.setInterval(reload, 30_000);
    window.addEventListener("focus", reload);
    document.addEventListener("visibilitychange", reload);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", reload); document.removeEventListener("visibilitychange", reload); };
  }, [refresh]);

  const shownCount = state.countKey === count ? state.inbox?.unread ?? count : count;
  return <InboxContext value={{ ...state, count: shownCount, now, refresh, read }}>{children}</InboxContext>;
}

export type NotificationBellProps = { count: number; className?: string; preview?: boolean; defaultOpen?: boolean; allHref?: string };

export function NotificationBell(props: NotificationBellProps) {
  const inbox = useContext(InboxContext);
  if (!inbox) return <NotificationInboxProvider count={props.count} preview={props.preview}><Bell {...props} /></NotificationInboxProvider>;
  return <Bell {...props} />;
}

function Bell({ className, defaultOpen = false, allHref = "/notifications" }: NotificationBellProps) {
  const inbox = useContext(InboxContext)!;
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const openChange = (next: boolean) => { setOpen(next); if (next) void inbox.refresh(); };
  const items = inbox.inbox?.items ?? [];
  const loading = !inbox.inbox && (inbox.phase === "idle" || inbox.phase === "loading");
  return <><Menu open={open} onOpenChange={openChange} label="Notifications" panelClassName={styles.panel}
    trigger={(props) => <IconButton {...props} icon="notifications" iconFill label={countLabel("Notifications", inbox.count)} className={[appStyles.navBtn, styles.bell, className].filter(Boolean).join(" ")}
      badge={<NavCount count={inbox.count} className={appStyles.navBtnCount} />} />}>
    <div className={styles.heading}>
      <b>Notifications</b>
      {inbox.count > 0 && <MenuItem className={styles.markAll} closeOnSelect={false} disabled={inbox.saving || loading} onSelect={() => { void inbox.read(null); }}>Mark all read</MenuItem>}
    </div>
    <div className={styles.rows} role="group" aria-label="Recent notifications" tabIndex={0} aria-busy={loading || inbox.saving}>
      {loading && <div className={styles.loading}>{[0, 1, 2].map((i) => <div key={i} className={styles.loadingRow}><Skeleton width={36} height={36} /><div><Skeleton width="90%" /><Skeleton width={50} height={12} /></div></div>)}</div>}
      {inbox.phase === "error" && <MenuItem icon="refresh" closeOnSelect={false} className={styles.retry} onSelect={() => { void inbox.refresh(); }}>Try again</MenuItem>}
      {!loading && inbox.phase !== "error" && items.length === 0 && <div className={styles.empty}><Icon name="notifications_none" decorative /><p>No notifications</p></div>}
      {items.map((item) => <MenuItem key={item.id} closeOnSelect={false} disabled={inbox.saving} className={[styles.row, item.readAt === null && styles.unread].filter(Boolean).join(" ")}
        onSelect={() => { void (async () => { if (await inbox.read(item.id)) { setOpen(false); router.push(item.href); } })(); }}>
        <span className={styles.icon}><Icon name={item.icon} fill decorative /></span>
        <span className={styles.body}><span className={styles.line}>{item.line}</span><time dateTime={item.createdAt}>{notificationTime(item.createdAt, inbox.now)}</time></span>
        {item.readAt === null && <span className={styles.dot} role="img" aria-label="Unread" />}
      </MenuItem>)}
    </div>
    <MenuItem href={allHref} className={styles.all}>See all notifications</MenuItem>
  </Menu>{open && <span role="status" className={appStyles.visuallyHidden}>{loading ? "Loading notifications" : inbox.phase === "error" ? "Notifications unavailable" : items.length === 0 ? "No notifications" : ""}</span>}</>;
}
