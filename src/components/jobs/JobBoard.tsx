"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Button } from "@/components/Button";
import { TextLink } from "@/components/TextLink";
import { useOptionalSessionExpired } from "@/components/auth/SessionExpired";
import { JobTile } from "@/components/cards/JobTile";
import { BoardMap, BoardMapSkeleton } from "./BoardMap";
import { SegmentedControl, Tabs } from "@/components/data/Tabs";
import { CheckboxField } from "@/components/forms/ChoiceFields";
import { SelectField } from "@/components/forms/TextFields";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState, InlineError } from "@/components/feedback/ErrorState";
import { LoadingRegion } from "@/components/feedback/LoadingRegion";
import { OfflineBanner, useOnlineStatus } from "@/components/feedback/OfflineBanner";
import { Skeleton } from "@/components/feedback/Skeleton";
import { BOARD_TRADES, BOARD_WHEN, BoardUpdateRequests, boardAlertsRoute, boardSettingsRoute, boardCardTag, boardCardWhen, boardDistanceLabel, boardHref, boardJobHref, boardSelectionKey, DEFAULT_BOARD_QUERY, parseBoardQuery, parseSavedJobs, savedJobsKey,
  type BoardKind, type BoardPage, type BoardQuery, type BoardResult, type BoardSource } from "@/lib/job-board";
import { loadJobBoardAction, newBoardJobsAction } from "@/server/jobs/board-actions";
import styles from "./board.module.css";

const LIVE_SOURCE: BoardSource = { load: loadJobBoardAction, updates: newBoardJobsAction };
const kindItems: { value: BoardKind; label: string }[] = [{ value: "all", label: "All jobs" }, { value: "ready", label: "Ready to claim" }, { value: "estimate", label: "Needs a quote" }, { value: "bounty", label: "Quote bounty" }];
const whenNames = { asap: "ASAP", week: "This week", flexible: "Flexible" };

export function BoardSkeleton({ count = 8 }: { count?: number }) {
  return <div className={styles.grid}>{Array.from({ length: count }, (_, i) => <div key={i} className={styles.skeletonCard}><Skeleton height="100%" /><Skeleton width="65%" height={14} /><Skeleton width="45%" height={12} /></div>)}</div>;
}

export type JobBoardProps = { initial: BoardResult; ownerId: string; source?: BoardSource; previewState?: string; initialSaved?: string[];
  /** Guarded map previews use the real board with a map default; public routes keep their existing defaults. */
  previewMap?: boolean;
  /** A slim message above the heading, e.g. the setup checklist's "Finish setup (4/6)" (#132). */
  notice?: ReactNode };
export function JobBoard({ initial, ownerId, source = LIVE_SOURCE, previewState, previewMap = false, initialSaved = [], notice }: JobBoardProps) {
  // Owner key at the route boundary remounts all state after an account switch. Stored data contains IDs only.
  const pathname = usePathname(), search = useSearchParams(), session = useOptionalSessionExpired();
  const urlQuery = parseBoardQuery(search);
  if (previewMap && !search.has("view") && !search.has("layout")) urlQuery.view = "map";
  if (previewMap && previewState === "chips-estimate" && !search.has("kind")) urlQuery.kind = "estimate";
  const urlKey = boardHref(urlQuery);
  const [location, setLocation] = useState(urlKey), [query, setQuery] = useState(urlQuery);
  // Controls respond in the click's render. Back/Forward still replaces them from the canonical URL.
  if (location !== urlKey) { setLocation(urlKey); setQuery(urlQuery); }
  const key = boardHref(query);
  const online = useOnlineStatus() && previewState !== "offline";
  const [result, setResult] = useState(initial), [saved, setSaved] = useState<string[]>(initialSaved), [hydrated, setHydrated] = useState(Boolean(previewState));
  const [storageError, setStorageError] = useState(previewState === "storage-error"), [busy, setBusy] = useState(previewState === "loading"), [more, setMore] = useState(previewState === "loading-more");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [error, setError] = useState(false), [newCount, setNewCount] = useState(previewState === "new-jobs" ? 3 : 0);
  const [loadedSelection, setLoadedSelection] = useState(() => boardSelectionKey(urlQuery, initialSaved));
  const [cacheInvalidated, setCacheInvalidated] = useState(!online);
  const generation = useRef(0), pending = useRef(false), sentinel = useRef<HTMLDivElement>(null), boardRef = useRef<BoardPage | null>(initial.ok ? initial.board : null), lastQuery = useRef(key);
  const [updates] = useState(() => new BoardUpdateRequests());
  const savedRef = useRef(saved), queryRef = useRef(query);
  const cachedBoard = result.ok ? result.board : null;
  const cacheChanged = (cacheInvalidated || !online) && loadedSelection !== boardSelectionKey(query, saved);
  const board = cacheChanged ? null : cachedBoard;
  useEffect(() => { savedRef.current = saved; queryRef.current = query; boardRef.current = cachedBoard; }, [saved, query, cachedBoard]);
  const extra = new URLSearchParams(search); for (const name of ["kind", "trade", "distance", "when", "sort", "saved", "estimated", "view", "layout"]) extra.delete(name);
  const href = (next: BoardQuery) => {
    const value = boardHref(next, pathname, extra.toString()), explicit = new URLSearchParams();
    if (previewMap && next.view === "grid") explicit.set("layout", "grid");
    if (previewMap && previewState === "chips-estimate" && next.kind === "all") explicit.set("kind", "all");
    return `${value}${explicit.size ? `${value.includes("?") ? "&" : "?"}${explicit}` : ""}`;
  };
  const update = (patch: Partial<BoardQuery>) => { const next = { ...query, ...patch }; updates.invalidate(); setQuery(next); window.history.pushState(null, "", href(next)); };
  const resetFilters = () => update({ ...DEFAULT_BOARD_QUERY, entry: query.entry, view: query.view });

  useEffect(() => {
    if (previewState) return;
    const read = () => { updates.invalidate(); try { setSaved(parseSavedJobs(localStorage.getItem(savedJobsKey(ownerId)))); setStorageError(false); } catch { setSaved([]); setStorageError(true); } setHydrated(true); };
    read();
    const changed = (event: StorageEvent) => { if (event.key === savedJobsKey(ownerId) || event.key === null) read(); };
    window.addEventListener("storage", changed); return () => window.removeEventListener("storage", changed);
  }, [ownerId, previewState, updates]);

  const load = useCallback(async function loadPage(append = false, quiet = false) {
    if (!online || pending.current || previewState === "loading" || previewState === "loading-more") return;
    const snapshot = boardRef.current, round = ++generation.current, current = queryRef.current, currentSaved = savedRef.current;
    updates.invalidate();
    pending.current = true; setError(false); if (append) setMore(true); else if (!quiet) setBusy(true);
    try {
      const answer = await source.load(current, { savedIds: currentSaved, ...(append && snapshot ? { cursor: snapshot.nextCursor, before: snapshot.before } : {}) });
      if (round !== generation.current) return;
      if (session?.check(answer, { resend: () => loadPage(false) })) return;
      if (!answer.ok && answer.error === "changed" && append) { pending.current = false; void loadPage(false); return; }
      if (answer.ok) {
        setLoadedSelection(boardSelectionKey(current, currentSaved));
        setCacheInvalidated(false);
        const ids = new Set(snapshot?.cards.map(card => card.id));
        setResult({ ok: true, board: append && snapshot ? { ...answer.board, cards: [...snapshot.cards, ...answer.board.cards.filter(card => !ids.has(card.id))] } : answer.board });
        if (!append && previewState !== "new-jobs") setNewCount(0);
      } else { setCacheInvalidated(true); if (snapshot) setError(true); else setResult(answer); }
    } catch { if (round === generation.current) { setCacheInvalidated(true); setError(true); } }
    finally { if (round === generation.current) { pending.current = false; setBusy(false); setMore(false); } }
  }, [online, previewState, session, source, updates]);

  const savedKey = saved.join(",");
  useEffect(() => {
    generation.current++; pending.current = false; updates.invalidate();
    const quiet = lastQuery.current === key; lastQuery.current = online ? key : "";
    if (!online) { setCacheInvalidated(true); setBusy(false); setMore(false); setNewCount(0); }
    else if (hydrated) void load(false, quiet);
    const cancel = () => { generation.current++; pending.current = false; updates.invalidate(); };
    return cancel;
  }, [key, savedKey, hydrated, online, load, updates]);

  useEffect(() => {
    if (!online || previewState || !hydrated) return;
    let active = true;
    const poll = async () => {
      const current = boardRef.current;
      if (!current || current.meta.blocked || pending.current || document.visibilityState === "hidden") return;
      try {
        const answer = await updates.run(() => source.updates(queryRef.current, { since: current.before, knownIds: current.cards.map(card => card.id), savedIds: savedRef.current }));
        if (active && answer?.ok) setNewCount(answer.count);
      } catch { /* Keep the current list; explicit reload reports an unavailable connection. */ }
    };
    const timer = setInterval(() => void poll(), 30_000);
    window.addEventListener("focus", poll);
    return () => { active = false; clearInterval(timer); window.removeEventListener("focus", poll); };
  }, [online, previewState, hydrated, source, key, savedKey, updates]);

  useEffect(() => {
    if (!board?.nextCursor || busy || more || error || !online || query.view === "map") return;
    const element = sentinel.current; if (!element) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) void load(true); }, { rootMargin: "200px" });
    observer.observe(element); return () => observer.disconnect();
  }, [board?.nextCursor, busy, more, error, online, query.view, load]);

  const save = (id: string, checked: boolean) => {
    const next = checked ? [...new Set([...saved, id])] : saved.filter(value => value !== id);
    try { const value = JSON.stringify(next); parseSavedJobs(value); if (!previewState) localStorage.setItem(savedJobsKey(ownerId), value); updates.invalidate(); setSaved(next); setStorageError(false); }
    catch { setStorageError(true); }
  };
  const cachedMeta = cachedBoard?.meta ?? (initial.ok ? initial.board.meta : null);
  const meta = cacheChanged && cachedMeta ? { ...cachedMeta, distanceKm: Math.min(query.distance ?? 25, cachedMeta.maxDistanceKm) } : cachedMeta;
  const returnTo = boardHref(query);
  const contact = `/contact?next=${encodeURIComponent(returnTo)}`;
  const alerts = boardAlertsRoute(returnTo).href;
  const filtered = boardHref({ ...query, entry: "find-work", view: "grid" }) !== "/jobs";
  return <div className={styles.page} data-mode="trade">
    <OfflineBanner online={previewState === "offline" ? false : undefined} onRetry={() => load()} sticky={false} />
    {notice}
    <div className={styles.heading}><div><h1>Jobs near you</h1><p>{board ? `${board.total} ${board.total === 1 ? "job" : "jobs"} · ${meta?.areaName}` : "Jobs near you"}</p></div>
      <SegmentedControl label="View" width="auto" value={query.view} onChange={view => update({ view })} items={[{ value: "grid", label: "Grid", icon: "grid_view" }, { value: "map", label: "Map", icon: "map" }]} controls="board-results" />
    </div>
    <div className={styles.layout}>
      <aside className={styles.sidebar} aria-label="Job filters"><button className={styles.filterToggle} type="button" aria-expanded={filtersOpen} aria-controls="job-filters" onClick={() => setFiltersOpen(value => !value)}>Filters</button><div id="job-filters" className={styles.filters} data-open={filtersOpen}>
        <fieldset><legend>Show</legend><CheckboxField label={`Already quoted${board ? ` (${board.counts.estimated})` : ""}`} checked={query.estimated} onChange={event => update({ estimated: event.target.checked })} />
          <CheckboxField label={`Saved${board ? ` (${board.counts.saved})` : ""}`} checked={query.saved} onChange={event => update({ saved: event.target.checked })} /></fieldset>
        <fieldset><legend>Trade</legend>{(meta?.trades ?? []).map(trade => <CheckboxField key={trade.trade} label={`${trade.label}${trade.reason ? ` · ${trade.reason}` : ""}`} disabled={!trade.allowed}
          checked={trade.allowed && (query.trades === null || query.trades.includes(trade.trade))} onChange={event => {
            const values = new Set(query.trades ?? BOARD_TRADES); if (event.target.checked) values.add(trade.trade); else values.delete(trade.trade);
            update({ trades: [...values] });
          }} />)}</fieldset>
        <SelectField label="Distance" value={meta?.distanceKm ?? ""} onChange={event => update({ distance: Number(event.target.value) })} disabled={!meta?.maxDistanceKm}>
          {[...new Set([5, 10, 25, 50, meta?.distanceKm, meta?.maxDistanceKm].filter((value): value is number => Boolean(value && meta && value <= meta.maxDistanceKm)))].sort((a, b) => a - b).map(km => <option key={km} value={km}>Within {km} km</option>)}
          {!meta?.maxDistanceKm && <option value="">Work area required</option>}
        </SelectField><p className={styles.area}>of {meta?.areaName ?? "your area"}</p>
        <fieldset><legend>When</legend>{BOARD_WHEN.map(when => <CheckboxField key={when} label={whenNames[when]} checked={query.when === null || query.when.includes(when)} onChange={event => {
          const values = new Set(query.when ?? BOARD_WHEN); if (event.target.checked) values.add(when); else values.delete(when); update({ when: [...values] });
        }} />)}</fieldset>
        <Button variant="tertiary" onClick={resetFilters}>Reset filters</Button>
      </div></aside>
      <section id="board-results" className={styles.results} aria-label="Jobs">
        {query.view !== "map" && <Tabs label="Job kind" items={kindItems.map(item => ({ ...item, count: board?.counts[item.value] }))} value={query.kind} onChange={kind => update({ kind })} controls="board-cards" />}
        <div className={styles.toolbar}><span>{meta ? `Within ${meta.distanceKm} km of ${meta.areaName}` : ""}</span><SelectField label="Sort by" value={query.sort} onChange={event => update({ sort: event.target.value as BoardQuery["sort"] })}>
          <option value="nearest">Nearest</option><option value="newest">Newest</option><option value="earn">Highest pay</option></SelectField></div>
        {storageError && <InlineError message="Couldn’t save your jobs on this browser. Check your browser storage and try again." />}
        {error && !cacheChanged && <InlineError message="Can’t load your jobs. Check your connection and try again." onRetry={() => load()} />}
        {newCount > 0 && <div className={styles.newJobs}><Button size="sm" onClick={() => load()} disabled={!online ? "You’re offline" : busy}>{newCount} new {newCount === 1 ? "job" : "jobs"}</Button></div>}
        <div id="board-cards"><LoadingRegion loading={busy || !hydrated} label="Loading your jobs" skeleton={query.view === "map" ? <BoardMapSkeleton /> : <BoardSkeleton />}>
          {cacheChanged ? <ErrorState className={styles.empty} title="Can’t load your jobs" message="Check your connection and try again." onRetry={() => load()} />
            : !result.ok ? <ErrorState className={styles.empty} title={result.error === "forbidden" ? "Trade account required" : "Can’t load your jobs"} message="Check your connection and try again." onRetry={() => load()} />
            : meta?.blocked ? <EmptyState className={styles.empty} icon="verified_user" title={meta.blocked === "worker-paused" ? "Your account is paused" : meta.blocked === "work-area-required" ? "Set your work area" : "Get verified to see jobs"}
              message={meta.blocked === "email-required" ? "Confirm your email to continue." : meta.blocked === "worker-paused" ? "Contact us to get back to work." : meta.blocked === "work-area-required" ? "Choose your suburb and travel radius." : "We need to check your ID before you can see jobs."}
              action={<Button href={meta.blocked === "work-area-required" ? boardSettingsRoute("/profile/area", returnTo).href : contact}>{meta.blocked === "work-area-required" ? "Set your work area" : "Contact us"}</Button>} />
            : query.view === "map" ? <><BoardMap cards={board?.cards ?? []} counts={board?.counts} query={query} ownerId={ownerId} config={meta?.map} serverNow={Date.parse(board?.before ?? "") || 0} onKindChange={kind => update({ kind })} previewState={previewState} previewBasePath={pathname} />
              {more && <LoadingRegion loading label="Loading more jobs" skeleton={<BoardMapSkeleton />} />}
              {board?.nextCursor && <div className={styles.more}><Button variant="secondary" loading={more} disabled={!online ? "You’re offline" : false} onClick={() => load(true)}>Load more jobs</Button></div>}
            </>
            : !board?.cards.length ? <div className={styles.empty}><EmptyState icon="search_off" title="No jobs match that." message="Try fewer filters."
              action={<Button onClick={() => meta && meta.distanceKm < meta.maxDistanceKm ? update({ distance: meta.maxDistanceKm }) : resetFilters()}>{meta && meta.distanceKm < meta.maxDistanceKm ? "Widen distance" : "Reset filters"}</Button>}
              secondaryAction={<TextLink href={alerts}>Alerts settings</TextLink>} /><p>Need to change your work area? <TextLink href={boardSettingsRoute("/profile/area", returnTo).href} inline>Change it</TextLink>.</p></div>
            : <><div className={styles.grid}>{board.cards.map(card => <div key={card.id} className={styles.card}>
              <JobTile href={previewState ? `/dev/components/job-board?state=detail${query.entry === "all" ? "&view=all" : ""}&from=${encodeURIComponent(returnTo)}` : boardJobHref(card.id, returnTo)} title={card.title} photo={card.photoUrl}
                meta={`${boardDistanceLabel(card.distanceKm)} · ${card.suburb}`} tag={boardCardTag(card)} saved={saved.includes(card.id)} onSavedChange={value => save(card.id, value)} shape="tall" headingLevel={2} />
              <div className={styles.cardFooter}><strong>{card.tradeLabel}</strong><span>{boardCardWhen(card, query.when)}</span></div>
            </div>)}</div>{more && <LoadingRegion loading label="Loading more jobs" skeleton={<BoardSkeleton count={4} />} />}
              {board.nextCursor && <div ref={sentinel} className={styles.more}><Button variant="secondary" loading={more} disabled={!online ? "You’re offline" : false} onClick={() => load(true)}>Load more jobs</Button></div>}
              <p className={styles.end} role="status">{board.cards.length} of {board.total} {board.total === 1 ? "job" : "jobs"}{filtered ? " · Filters on" : ""}</p></>}
        </LoadingRegion></div>
      </section>
    </div>
  </div>;
}
