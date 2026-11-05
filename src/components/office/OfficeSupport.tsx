"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type FormEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/Button";
import { useOptionalSessionExpired } from "@/components/auth/SessionExpired";
import { DataTable, Pagination, TableItem, type Column } from "@/components/data";
import { EmptyState, ErrorState, LoadingRegion, SkeletonText } from "@/components/feedback";
import { OfflineBanner, useOnlineStatus } from "@/components/feedback/OfflineBanner";
import { SelectField, TextAreaField, TextField } from "@/components/forms/TextFields";
import { Icon } from "@/components/Icon";
import { Banner } from "@/components/overlays/Banner";
import { MessageBubble } from "@/components/messages/MessageBubble";
import { OFFICE_SUPPORT_PAGE_SIZE, OFFICE_SUPPORT_PATH, officeSupportJobHref, officeSupportSearch, officeSupportThreadHref, type OfficeSupportQuery } from "@/lib/office-support";
import { messageDraftKey, type MessageResult } from "@/lib/problem-threads";
import { SUPPORT_ERRORS } from "@/lib/support";
import type { AuthFailure } from "@/lib/auth/results";
import { markOfficeSupportReadAction, sendOfficeSupportMessageAction } from "@/server/office/support-actions";
import type { OfficeSupportDetail, OfficeSupportPage, OfficeSupportRow } from "@/server/office/support";
import styles from "./support.module.css";

const rowHref = (row: OfficeSupportRow, query: OfficeSupportQuery) => row.kind === "job" && row.job ? officeSupportJobHref(row.job.id, query) : officeSupportThreadHref(row.id, query);

export function OfficeSupportInbox({ query, data, loading = false, previewOffline = false }: {
  query: OfficeSupportQuery; data: OfficeSupportPage | null; loading?: boolean; previewOffline?: boolean;
}) {
  const router = useRouter(), browserOnline = useOnlineStatus();
  const online = browserOnline && !previewOffline;
  const [pending, transition] = useTransition();
  const [q, setQ] = useState(query.q), [status, setStatus] = useState(query.status), [seen, setSeen] = useState(query);
  if (query.q !== seen.q || query.status !== seen.status) { setSeen(query); setQ(query.q); setStatus(query.status); }
  function navigate(next: OfficeSupportQuery) { if (online && !pending) transition(() => router.push(`${OFFICE_SUPPORT_PATH}${officeSupportSearch(next)}`, { scroll: false })); }
  function submit(event: FormEvent) { event.preventDefault(); navigate({ q: q.trim(), status, page: 1 }); }
  const shownQuery = { ...query, page: data?.page ?? query.page };
  const columns: Column<OfficeSupportRow>[] = [
    { key: "subject", header: "Thread", primary: true, cell: row => <TableItem href={online ? rowHref(row, shownQuery) : undefined} title={row.subject} meta={<span className={styles.preview}>{row.preview || "No messages yet."}</span>} /> },
    { key: "owner", header: "From", cell: row => <span className={styles.person}><b>{row.owner.name}</b><span>{row.owner.email}</span></span> },
    { key: "job", header: "Job", optional: true, cell: row => row.job ? <span>{row.job.number}<span className={styles.secondary}>{row.job.title}</span></span> : <span>—</span> },
    { key: "status", header: "Status", nowrap: true, cell: row => <span className={styles.badge} data-closed={row.closed || undefined}>{row.closed ? "Closed" : "Open"}{row.unread && <span className={styles.unread} role="img" aria-label="Unread" />}</span> },
    { key: "updated", header: "Updated", optional: true, cell: row => <time dateTime={row.updatedAt}>{row.when}</time> },
  ];
  const filtered = Boolean(query.q) || query.status !== "open";
  const emptyTitle = query.q ? "No threads match that." : query.status === "closed" ? "No closed threads." : query.status === "open" ? "No open threads." : "No threads yet.";
  return <section className={styles.page}>
    <header className={styles.heading}><h1>Support inbox</h1></header>
    <OfflineBanner sticky={false} online={previewOffline ? false : undefined} onRetry={() => router.refresh()} className={styles.notice} />
    <form className={styles.filters} onSubmit={submit} data-offline-queue="off">
      <TextField type="search" name="q" label="Search threads" placeholder="Search" value={q} maxLength={100} onChange={event => setQ(event.target.value)} />
      <SelectField label="Status" name="status" value={status} onChange={event => setStatus(event.target.value as OfficeSupportQuery["status"])}>
        <option value="open">Open</option><option value="closed">Closed</option><option value="all">All</option>
      </SelectField>
      <Button type="submit" width="auto" disabled={!online ? "You’re offline." : pending}>Search</Button>
    </form>
    <DataTable caption="Support inbox" columns={columns} rows={data?.rows ?? []} rowId={row => row.id} rowLabel={row => row.subject} rowHref={online ? row => rowHref(row, shownQuery) : undefined} loading={loading || pending} loadingLabel="Loading messages"
      error={!loading && !data ? <ErrorState title="Can’t load messages." message="Check your connection and try again." onRetry={() => transition(() => router.refresh())} retrying={pending} headingLevel={2} /> : undefined}
      empty={<EmptyState icon={query.q ? "search_off" : "inbox"} title={emptyTitle} headingLevel={2} action={filtered ? <Button variant="secondary" width="auto" disabled={!online} onClick={() => navigate({ q: "", status: "open", page: 1 })}>Clear filters</Button> : undefined} />}
      footer={data && data.total > 0 ? <fieldset className={styles.pager} aria-label="Thread pages" disabled={!online || pending}><Pagination label="Threads" page={data.page} pageSize={OFFICE_SUPPORT_PAGE_SIZE} total={data.total} onPageChange={page => navigate({ ...query, page })} /></fieldset> : undefined} />
  </section>;
}

export type OfficeReplyActions = {
  send: (id: string, input: { text: string; requestKey: string; photoPaths: string[] }) => Promise<MessageResult | AuthFailure>;
  read: (id: string, messageId: string) => Promise<{ ok: boolean; error?: string }>;
};
type PrivateDetail = Extract<OfficeSupportDetail, { kind: "support" }>;

export function OfficeSupportConversation({ query, data, loading = false, preview, actions }: {
  query: OfficeSupportQuery; data: PrivateDetail | null; loading?: boolean; preview?: "offline" | "sent" | "send-error" | "sending"; actions?: OfficeReplyActions;
}) {
  const router = useRouter(), session = useOptionalSessionExpired(), browserOnline = useOnlineStatus();
  const online = browserOnline && preview !== "offline";
  const thread = data?.conversation;
  const listHref = `${OFFICE_SUPPORT_PATH}${officeSupportSearch(query)}`;
  const messages = thread?.messages;
  const visibleMessageId = messages?.at(-1)?.id;
  const messageLog = useRef<HTMLDivElement>(null), followLatest = useRef(true);
  useEffect(() => {
    if (!thread?.id || !visibleMessageId || !online) return;
    let active = true;
    const read = () => { if (active && document.visibilityState === "visible") void (actions?.read ?? markOfficeSupportReadAction)(thread.id, visibleMessageId).catch(() => {}); };
    const frame = requestAnimationFrame(read);
    document.addEventListener("visibilitychange", read);
    return () => { active = false; cancelAnimationFrame(frame); document.removeEventListener("visibilitychange", read); };
  }, [thread?.id, visibleMessageId, online, actions]);
  useEffect(() => {
    const log = messageLog.current;
    if (log && followLatest.current && !thread?.earlier) log.scrollTop = log.scrollHeight;
  }, [thread?.id, visibleMessageId, thread?.earlier]);
  useEffect(() => {
    if (!thread?.id || !online || preview) return;
    const timer = setInterval(() => { if (document.visibilityState === "visible" && document.activeElement?.tagName !== "TEXTAREA") router.refresh(); }, 30_000);
    return () => clearInterval(timer);
  }, [thread?.id, online, preview, router]);
  return <section className={styles.page}>
    <Link className={styles.back} href={listHref}><Icon name="arrow_back" decorative />Support inbox</Link>
    <header className={styles.heading}><h1>{thread?.subject ?? "Support inbox"}</h1>{thread && <span className={styles.badge} data-closed={thread.closed || undefined}>{thread.closed ? "Closed" : "Open"}</span>}</header>
    <OfflineBanner sticky={false} online={preview === "offline" ? false : undefined} onRetry={() => router.refresh()} className={styles.notice} />
    <LoadingRegion loading={loading} label="Loading messages" skeleton={<div className={styles.card}><SkeletonText lines={7} /></div>}>
      {!data ? <div className={styles.card}><ErrorState title="Can’t load messages." message="Check your connection and try again." onRetry={() => router.refresh()} headingLevel={2} /></div> : <>
        <div className={styles.details}><div className={styles.card}><span className={styles.secondary}>From</span><p className={styles.owner}>{data.owner.name}</p><p>{data.owner.email}</p></div>{data.job && <div className={styles.card}><span className={styles.secondary}>{data.job.number}</span><p className={styles.owner}>{data.job.title}</p><Button href={officeSupportJobHref(data.job.id, query, thread!.id)} variant="secondary" width="auto" size="sm">View job</Button></div>}</div>
        <section className={styles.conversation}><h2 className={styles.sectionTitle}>Messages</h2>
          {(thread!.olderCursor || thread!.earlier) && <nav className={styles.history} aria-label="Message history">
            {thread!.olderCursor && <Link prefetch={false} href={officeSupportThreadHref(thread!.id, query, thread!.olderCursor)}>Earlier</Link>}
            {thread!.earlier && <Link prefetch={false} href={officeSupportThreadHref(thread!.id, query)}>Latest</Link>}
          </nav>}
          <div ref={messageLog} onScroll={() => { const log = messageLog.current; if (log) followLatest.current = log.scrollHeight - log.scrollTop - log.clientHeight < 48; }} className={styles.messages} role="log" aria-live="polite" aria-relevant="additions" aria-label="Conversation" tabIndex={0}>
            {messages?.length ? messages.map(message => <MessageBubble key={message.id} message={message} latest={message.id === thread!.latestMessageId} />) : <p className={styles.empty}>No messages yet.</p>}
          </div>
          {thread!.closed ? <p className={styles.closed}>This thread is closed.</p> : <OfficeReply key={thread!.id} detail={data} online={online} preview={preview} send={actions?.send ?? sendOfficeSupportMessageAction} checkSession={(result, resend) => Boolean(session?.check(result, { resend }))} onSent={() => { followLatest.current = true; if (thread!.earlier) router.push(officeSupportThreadHref(thread!.id, query)); router.refresh(); }} />}
        </section>
      </>}
    </LoadingRegion>
  </section>;
}

function OfficeReply({ detail, online, preview, send, checkSession, onSent }: { detail: PrivateDetail; online: boolean; preview?: string; send: OfficeReplyActions["send"]; checkSession: (result: MessageResult | AuthFailure, resend: () => void) => boolean; onSent: () => void }) {
  const area = useRef<HTMLTextAreaElement>(null), form = useRef<HTMLFormElement>(null), pending = useRef(false), request = useRef<string | null>(null), focusAfterSend = useRef(false);
  const key = messageDraftKey(detail.viewerId, `office-support-${detail.conversation.id}`);
  const [text, setText] = useState(preview && preview !== "sent" ? "Thanks. We’ll check your account details." : ""), [ready, setReady] = useState(false), [busy, setBusy] = useState(preview === "sending"), [failed, setFailed] = useState(preview === "send-error" ? "unavailable" : ""), [sent, setSent] = useState(preview === "sent");
  useEffect(() => { if (!busy && focusAfterSend.current) { focusAfterSend.current = false; area.current?.focus(); } }, [busy]);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      try { const saved = JSON.parse(localStorage.getItem(key) ?? "null"); if (saved?.version === 1 && typeof saved.text === "string") { setText(saved.text.slice(0, 4000)); request.current = typeof saved.requestKey === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(saved.requestKey) ? saved.requestKey : null; } } catch {}
      setReady(true);
    });
    return () => { active = false; };
  }, [key]);
  function save(value: string, requestKey: string | null) { try { if (value) localStorage.setItem(key, JSON.stringify({ version: 1, text: value, requestKey })); else localStorage.removeItem(key); } catch {} }
  function edit(value: string) { setText(value); request.current = null; setSent(false); save(value, null); }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || pending.current || !online || !text.trim()) return;
    pending.current = true; setBusy(true); setFailed(""); setSent(false); request.current ??= crypto.randomUUID();
    save(text, request.current);
    try {
      const result = await send(detail.conversation.id, { text, photoPaths: [], requestKey: request.current });
      if (checkSession(result, () => form.current?.requestSubmit())) return;
      if (result.ok) { edit(""); request.current = null; setSent(true); focusAfterSend.current = true; onSent(); }
      else setFailed(result.error);
    } catch { setFailed("unavailable"); }
    finally { pending.current = false; setBusy(false); }
  }
  function keyboard(event: KeyboardEvent<HTMLTextAreaElement>) { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }
  return <form ref={form} className={styles.composer} onSubmit={submit} data-offline-queue="off">
    {failed && <Banner tone="alert" live className={styles.notice}>{SUPPORT_ERRORS[failed] ?? SUPPORT_ERRORS.unavailable}</Banner>}
    {sent && <Banner tone="good" live title="Sent" className={styles.notice} />}
    <TextAreaField ref={area} name="text" label="Message" value={text} maxLength={4000} rows={4} onChange={event => edit(event.target.value)} onKeyDown={keyboard} disabled={!ready || busy} hint="Enter to send, Shift+Enter for a new line" />
    <Button type="submit" width="auto" loading={busy} disabled={!online ? "You’re offline." : !ready || !text.trim()}>Send message</Button>
  </form>;
}
