"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition, type MouseEvent, type RefObject } from "react";
import { Button, buttonClasses } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { useOptionalSessionExpired } from "@/components/auth/SessionExpired";
import { DataTable, Pagination, TableItem, Tabs, type Column } from "@/components/data";
import { EmptyState, ErrorState, InlineError, OfflineBanner, SkeletonText, useOnlineStatus } from "@/components/feedback";
import { SelectField, TextAreaField, TextField } from "@/components/forms";
import { Dialog, ToastProvider, useToast } from "@/components/overlays";
import { Pill } from "@/components/status/Pill";
import { VerifiedBadge } from "@/components/status/VerifiedBadge";
import { Avatar } from "@/components/media/Avatar";
import { tradeLabel } from "@/lib/account/trades";
import { OFFICE_TRADIES_PAGE_SIZE, TRADIE_ERRORS, tradiesHref, tradiesQuery, type TradieDecision, type TradieDecisionResult, type TradieDetail, type TradieRow, type TradiesPage, type TradiesQuery } from "@/lib/office-tradies";
import { decideTradieAction } from "@/server/office/tradie-actions";
import styles from "./tradies.module.css";

export type OfficeTradiesState = "default" | "loading" | "empty" | "error" | "offline" | "success" | "reject" | "pause" | "unpause" | "save-error";
type Props = { data: TradiesPage | null; query: TradiesQuery; state?: OfficeTradiesState;
  decide?: (input: TradieDecision) => Promise<TradieDecisionResult>; navigate?: (query: TradiesQuery) => void; hrefFor?: (href: string) => string; refresh?: () => void };
const identity = (href: string) => href;
export function OfficeTradies(props: Props) { return <ToastProvider initial={props.state === "success" ? { message: "Saved." } : undefined}><TradiesContent {...props} /></ToastProvider>; }

function TradiesContent({ data, query, state = "default", decide = decideTradieAction, navigate, hrefFor = identity, refresh }: Props) {
  const router = useRouter(), [pending, startTransition] = useTransition(), [search, setSearch] = useState(query.q), latest = useRef(query), typed = useRef(false), heading = useRef<HTMLHeadingElement>(null), detailHeading = useRef<HTMLHeadingElement>(null), previousSelection = useRef(query.selected);
  const detailVersion = data?.selected ? `${data.selected.id}:${data.selected.licence?.version}:${data.selected.pausedAt}` : null, previousDetail = useRef(detailVersion);
  const context = `${query.tab}:${query.q}:${query.sort}:${query.page}`, previousContext = useRef(context);
  useEffect(() => { if (previousSelection.current && !query.selected && previousContext.current === context) heading.current?.focus(); previousSelection.current = query.selected; previousContext.current = context; }, [query.selected, context]);
  useEffect(() => { latest.current = query; }, [query]);
  const [lastQuery, setLastQuery] = useState(query.q);
  if (lastQuery !== query.q) { setLastQuery(query.q); setSearch(query.q); }
  const [historyTarget, setHistoryTarget] = useState<TradiesQuery | "leaving" | null>(null);
  const historyPage = historyTarget && historyTarget !== "leaving" ? data ? Math.min(historyTarget.page, Math.max(1, Math.ceil(data.total / OFFICE_TRADIES_PAGE_SIZE))) : historyTarget.page : query.page;
  const historyPending = historyTarget === "leaving" || Boolean(historyTarget && (historyTarget.tab !== query.tab || historyTarget.q !== query.q || historyTarget.sort !== query.sort || historyTarget.selected !== query.selected || historyPage !== query.page));
  // History traversal does not join our link transition. Wait for the committed destination,
  // not a new props object: an unrelated refresh can still contain the previous person's record.
  if (historyTarget && !historyPending) setHistoryTarget(null);
  useEffect(() => {
    const onHistory = () => {
      const url = new URL(location.href), ownPath = new URL(hrefFor("/admin/tradies"), location.href).pathname;
      setHistoryTarget(url.pathname === ownPath ? tradiesQuery(Object.fromEntries(url.searchParams)) : "leaving");
    };
    window.addEventListener("popstate", onHistory, true);
    return () => window.removeEventListener("popstate", onHistory, true);
  }, [hrefFor]);
  const go = (changes: Partial<TradiesQuery>, replace = false) => {
    setHistoryTarget(null);
    latest.current = { ...latest.current, ...changes };
    startTransition(() => { if (navigate) navigate(latest.current); else (replace ? router.replace : router.push)(tradiesHref(latest.current), { scroll: false }); });
  };
  function follow(event: MouseEvent<HTMLDivElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !(event.target instanceof Element)) return;
    const anchor = event.target.closest<HTMLAnchorElement>("a[href]");
    if (!anchor || anchor.target === "_blank") return;
    const url = new URL(anchor.href), ownPath = new URL(hrefFor("/admin/tradies"), location.href).pathname;
    if (url.origin !== location.origin || url.pathname !== ownPath) return;
    // Every table/detail navigation shares the transition. The old person's editable form must disappear
    // immediately, before a quick click + keystroke can put the next person's note on the previous record.
    event.preventDefault(); go(tradiesQuery(Object.fromEntries(url.searchParams)));
  }
  useEffect(() => {
    if (!typed.current || search.trim() === latest.current.q) return;
    const timer = window.setTimeout(() => go({ q: search.trim(), selected: null, page: 1 }, true), 300);
    return () => window.clearTimeout(timer);
    // Search alone starts the debounce; latest holds any intervening tab/sort change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);
  const connected = useOnlineStatus(), online = state !== "offline" && connected, loading = state === "loading" || pending || historyPending;
  useEffect(() => { if (loading) return; if (detailVersion && previousDetail.current !== detailVersion) detailHeading.current?.focus(); previousDetail.current = detailVersion; }, [detailVersion, loading]);
  const columns: Column<TradieRow>[] = [
    { key: "name", header: "Name", primary: true, cell: row => <TableItem title={row.name} href={hrefFor(tradiesHref(query, { selected: row.id }))} /> },
    { key: "trade", header: "Trade", cell: row => tradeLabel(row.trade) },
    { key: "number", header: "Licence no.", cell: row => row.licenceNumber ?? (row.trade === "OTHER" ? "No licence needed" : "Not provided") },
    { key: "date", header: query.tab === "verified" ? "Expiry" : "Signed up", optional: query.tab !== "verified", cell: row => query.tab === "verified" ? row.expiry ?? "—" : <time dateTime={row.joinedAt}>{row.joined}</time> },
  ];
  return <div className={styles.page} onClickCapture={follow}><h1 ref={heading} tabIndex={-1}>Tradies</h1><OfflineBanner online={state === "offline" ? false : undefined} sticky={false} />
    <Tabs label="Tradie checks" value={query.tab} onChange={tab => go({ tab, selected: null, page: 1 })} items={[{ value: "check", label: "To check", count: data?.counts.check ?? 0 }, { value: "verified", label: "Verified", count: data?.counts.verified ?? 0 }, { value: "paused", label: "Paused", count: data?.counts.paused ?? 0 }]}>
      <div className={styles.filters}><TextField label="Search tradies" type="search" value={search} placeholder="Search" maxLength={160} onChange={event => { typed.current = true; setSearch(event.target.value); }} /><SelectField label="Sort" value={query.sort} onChange={event => go({ sort: event.target.value === "expiry" ? "expiry" : "joined", page: 1 })}><option value="joined">Newest sign-ups</option><option value="expiry">Expiring soon</option></SelectField></div>
      <div className={styles.layout} data-selected={Boolean(data?.selected)}>
        <div className={styles.table}><DataTable caption="Tradies" rows={state === "empty" ? [] : data?.rows ?? []} rowId={row => row.id} rowLabel={row => `${row.name}, ${tradeLabel(row.trade)}`} columns={columns} activeRowId={query.selected} rowHref={row => hrefFor(tradiesHref(query, { selected: row.id }))} loading={loading} loadingLabel="Loading tradies" rowActions={row => <Link href={hrefFor(tradiesHref(query, { selected: row.id }))} className={buttonClasses({ variant: "tertiary", size: "sm" })} aria-label={`Review ${row.name}, ${tradeLabel(row.trade)}`}>Review</Link>}
          error={state === "error" || !data ? <ErrorState title="Can’t load tradies." onRetry={() => (refresh ?? router.refresh)()} /> : undefined}
          empty={<EmptyState icon="badge" title={query.q ? "No tradies match that search." : query.tab === "check" ? "No tradies to check." : query.tab === "paused" ? "No paused tradies." : "No verified licences yet."} />}
          footer={<Pagination label="Tradie pages" page={data?.page ?? 1} total={state === "empty" ? 0 : data?.total ?? 0} pageSize={OFFICE_TRADIES_PAGE_SIZE} getHref={page => hrefFor(tradiesHref(query, { page, selected: null }))} />} /></div>
        {loading ? <aside className={styles.detail} aria-label="Loading tradie details"><SkeletonText lines={6} /></aside> : data?.selected && state !== "error" && state !== "empty" ? <TradieEditor key={`${data.selected.id}:${data.selected.licence?.version ?? "none"}:${data.selected.pausedAt}`} detail={data.selected} viewerId={data.viewerId} today={data.today} online={online} state={state} decide={decide} closeHref={hrefFor(tradiesHref(query, { selected: null }))} refresh={refresh ?? router.refresh} headingRef={detailHeading} /> : null}
      </div>
    </Tabs>
  </div>;
}

const register = {
  ELECTRICAL: { label: "Check on the EWRB register", href: "https://kete.mbie.govt.nz/EW/EWPRSearch/" },
  PLUMBING: { label: "Check on the PGDB register", href: "https://www.pgdb.co.nz/advice_for_consumers/search_the_register/" },
  GAS: { label: "Check on the PGDB register", href: "https://www.pgdb.co.nz/advice_for_consumers/search_the_register/" },
  CONSTRUCTION: { label: "Check on the LBP register", href: "https://kete-lbp.mbie.govt.nz/advanced-building-practitioner-search/" },
};
function TradieEditor({ detail, viewerId, today, online, state, decide, closeHref, refresh, headingRef }: { detail: TradieDetail; viewerId: string; today: string; online: boolean; state: OfficeTradiesState; decide: (input: TradieDecision) => Promise<TradieDecisionResult>; closeHref: string; refresh: () => void; headingRef: RefObject<HTMLHeadingElement | null> }) {
  const [note, setNote] = useState(""), [reason, setReason] = useState(""), [pauseNote, setPauseNote] = useState(""), [draftReady, setDraftReady] = useState(false);
  const [dialog, setDialog] = useState<TradieDecision["kind"] | null>(state === "reject" ? "reject" : state === "pause" ? "pause" : state === "unpause" ? "unpause" : null), [error, setError] = useState(state === "save-error" ? TRADIE_ERRORS.unavailable : ""), [sending, setSending] = useState(false), [awaitingRefresh, setAwaitingRefresh] = useState(false);
  const busy = sending || awaitingRefresh;
  const session = useOptionalSessionExpired(), toast = useToast(), reasonArea = useRef<HTMLTextAreaElement>(null), decisionForm = useRef<HTMLFormElement>(null), formId = useId();
  const key = `trade.office-tradie-note.${viewerId}.${detail.id}.${detail.licence?.version ?? "none"}`;
  useEffect(() => { let active = true; queueMicrotask(() => { if (!active) return; try { const draft = JSON.parse(localStorage.getItem(key) ?? "null"); if (draft) { if (typeof draft.note === "string") setNote(draft.note.slice(0, 2000)); if (typeof draft.reason === "string") setReason(draft.reason.slice(0, 2000)); if (typeof draft.pauseNote === "string") setPauseNote(draft.pauseNote.slice(0, 2000)); } } catch {} setDraftReady(true); }); return () => { active = false; }; }, [key]);
  const draft = (values: { note?: string; reason?: string; pauseNote?: string }) => { try { localStorage.setItem(key, JSON.stringify({ note, reason, pauseNote, ...values })); } catch {} };
  async function save() {
    if (!dialog || !online || busy || !draftReady) return;
    const pausing = dialog === "pause" || dialog === "unpause";
    if (!(pausing ? pauseNote : note).trim()) { setError(TRADIE_ERRORS.invalid); return; }
    if (dialog === "reject" && !reason.trim()) { setError("Add a reason the tradie will see."); reasonArea.current?.focus(); return; }
    let input: TradieDecision;
    if (dialog === "pause" || dialog === "unpause") input = { kind: dialog, userId: detail.userId, expectedPausedAt: detail.pausedAt, note: pauseNote };
    else {
      if (!detail.licence || detail.trade === "OTHER") return;
      const base = { userId: detail.userId, trade: detail.trade, version: detail.licence.version, note };
      input = dialog === "reject" ? { ...base, kind: "reject", reason } : { ...base, kind: "approve" };
    }
    setSending(true); setError("");
    try {
      const result = await decide(input);
      if (result.ok) { setAwaitingRefresh(true); setDialog(null); try { localStorage.removeItem(key); } catch {} toast.show({ message: "Saved." }); refresh(); }
      else if (!session?.check(result, { resend: () => decisionForm.current?.requestSubmit() })) setError(TRADIE_ERRORS[result.error]);
    } catch { setError(TRADIE_ERRORS.unavailable); }
    finally { setSending(false); }
  }
  const licence = detail.licence, pendingLicence = licence?.status === "PENDING" && detail.trade !== "OTHER", official = detail.trade === "OTHER" ? null : register[detail.trade];
  const title = dialog === "approve" ? "Approve licence?" : dialog === "reject" ? "Reject licence?" : dialog === "unpause" ? "Unpause tradie?" : "Pause tradie?";
  const label = dialog === "approve" ? "Approve" : dialog === "reject" ? "Reject" : dialog === "unpause" ? "Unpause" : "Pause";
  return <aside className={styles.detail} aria-label="Tradie details"><Link href={closeHref} className={styles.close}><Icon name="arrow_back" decorative />Back</Link><div className={styles.person}><Avatar name={detail.name} decorative size="lg" className={styles.avatar} /><div><h2 ref={headingRef} tabIndex={-1}>{detail.name}</h2><p>{detail.suburb ?? detail.email}</p><VerifiedBadge verified={detail.verifiedBadge} trade={detail.trade} /></div></div>
    {detail.paused && <div className={styles.banner} role="status"><Icon name="pause_circle" decorative /><span>Paused</span></div>}
    <h3 className={styles.checking}>Checking: {tradeLabel(detail.trade)}</h3><Pill kind={detail.status === "Checked" || detail.status === "No licence needed" ? "good" : detail.status === "Rejected" || detail.status === "Expired" ? "alert" : "waiting"}>{detail.status}</Pill>
    {detail.trade !== "OTHER" && <><dl className={styles.facts}><dt>Licence number</dt><dd>{detail.licenceNumber ?? "Not provided"}</dd><dt>Name on licence</dt><dd>{licence?.documentHref ? "Check the uploaded licence" : "Not provided"}</dd><dt>Expiry</dt><dd>{detail.expiry ?? "Not provided"}</dd><dt>Uploaded</dt><dd>{licence?.documentHref ? <a target="_blank" rel="noopener noreferrer" href={licence.documentHref}>View licence</a> : "Not provided"}</dd></dl>{official && <Button variant="secondary" size="sm" href={official.href} target="_blank" rel="noopener noreferrer" icon="open_in_new">{official.label}</Button>}
      {licence?.reason && <div className={styles.banner}><p>{licence.reason}</p></div>}
      {pendingLicence && <><TextAreaField label="Note (saved with the decision)" value={note} maxLength={2000} rows={3} required disabled={busy || !draftReady} onChange={event => { setNote(event.target.value); draft({ note: event.target.value }); }} /><div className={styles.decisions}><Button disabled={!online || !note.trim() || busy || !draftReady} onClick={() => { setError(""); setDialog("approve"); }}>Approve</Button><Button variant="destructive" disabled={!online || !note.trim() || busy || !draftReady} onClick={() => { setError(""); setDialog("reject"); }}>Reject…</Button></div>{(!detail.expiry || detail.expiry < today) && <p className={styles.hint}>{TRADIE_ERRORS.expiry}</p>}</>}
    </>}
    {error && !dialog && <InlineError message={error} />}
    <div className={styles.pause}><Button variant="secondary" icon={detail.paused ? "play_arrow" : "pause"} disabled={!online || busy || !draftReady || !detail.hasWorkerProfile} onClick={() => { setError(""); setDialog(detail.paused ? "unpause" : "pause"); }}>{detail.paused ? "Unpause" : "Pause"}</Button></div>
    <section className={styles.timeline} aria-label="Audit timeline"><h3>Timeline</h3>{detail.timeline.length ? <ol>{detail.timeline.map(entry => <li key={entry.id}><b>{entry.action}</b><span>{entry.actor} · <time dateTime={entry.at}>{entry.when}</time></span>{entry.note && <p>{entry.note}</p>}{entry.reason && <p>{entry.reason}</p>}</li>)}</ol> : <p>No decisions yet.</p>}</section>
    <Dialog open={dialog !== null} title={title} role="alertdialog" dismissible={!busy} onClose={() => { if (!busy) { setDialog(null); setError(""); } }} footer={<><Button variant="secondary" disabled={busy} onClick={() => { setDialog(null); setError(""); }}>Not now</Button><Button form={formId} type="submit" variant={dialog === "reject" || dialog === "pause" ? "destructive" : "primary"} loading={busy} disabled={!online || busy || !draftReady || !(dialog === "pause" || dialog === "unpause" ? pauseNote : note).trim() || (dialog === "reject" && !reason.trim())}>{label}</Button></>}>
      <form ref={decisionForm} id={formId} data-offline-queue="off" onSubmit={event => { event.preventDefault(); void save(); }}>
        {dialog === "pause" || dialog === "unpause" ? <TextAreaField label="Reason" value={pauseNote} maxLength={2000} rows={3} required disabled={busy || !draftReady} onChange={event => { setPauseNote(event.target.value); draft({ pauseNote: event.target.value }); }} /> : dialog === "reject" ? <TextAreaField ref={reasonArea} label="Reason shown to the tradie" value={reason} maxLength={2000} rows={3} required disabled={busy || !draftReady} onChange={event => { setReason(event.target.value); draft({ reason: event.target.value }); }} /> : <p>{note}</p>}
        {error && <InlineError message={error} />}
      </form>
    </Dialog>
  </aside>;
}
