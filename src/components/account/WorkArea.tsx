"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { TextLink } from "@/components/TextLink";
import { WorkerAreaFields } from "@/components/auth/WorkerSignupFields";
import { useOptionalSessionExpired } from "@/components/auth/SessionExpired";
import { ErrorState, InlineError, LiveMessage, LoadingRegion, OfflineBanner, Skeleton, useOnlineStatus } from "@/components/feedback";
import { SwitchField } from "@/components/forms/ChoiceFields";
import { ApproxArea } from "@/components/map/MapPin";
import { MapboxSurface, type MapboxViewport } from "@/components/map/MapboxSurface";
import { Banner } from "@/components/overlays/Banner";
import { ToastProvider, useToast } from "@/components/overlays/Toast";
import { parseWorkArea, workAreaChanged, WORK_AREA_SELECTION_ERROR, type AvailabilitySave, type WorkAreaErrors, type WorkAreaInput, type WorkAreaSave, type WorkAreaSnapshot, type WorkAreaState } from "@/lib/account/work-area";
import { tradeLabel } from "@/lib/account/trades";
import { workAreaBounds } from "@/lib/map/mapbox";
import { boardSettingsRoute } from "@/lib/job-board";
import { searchWorkAreaAction, saveWorkAreaAction, setAvailableAction } from "@/server/workers/area-actions";
import type { SignupAreaResult, SignupAreaSuggestion } from "@/server/auth/work-area";
import account from "./account.module.css";
import styles from "./work-area.module.css";

type Props = { initial: WorkAreaSnapshot | null; accessToken?: string | null; save?: WorkAreaSave; setAvailable?: AvailabilitySave; preview?: WorkAreaState;
  search?: (query: string) => Promise<SignupAreaResult>; suggestions?: SignupAreaSuggestion[]; onRetry?: () => void; next?: string | null };

const searchArea = async (query: string): Promise<SignupAreaResult> => {
  const result = await searchWorkAreaAction(query);
  return "mode" in result ? result : { mode: "manual", reason: "unavailable" };
};

export function WorkAreaLoading() {
  return <><h1 className={account.title}>Work area</h1><LoadingRegion loading label="Loading work area" skeleton={<div className={account.sections}>
    {[0, 1, 2, 3].map(item => <div className={`${account.card} ${styles.card}`} key={item}><Skeleton width="50%" height={24} /><Skeleton height={48} /></div>)}
  </div>} /></>;
}

export function WorkArea(props: Props) {
  return <ToastProvider><WorkAreaForm key={props.initial ? "loaded" : "error"} {...props} /></ToastProvider>;
}

function WorkAreaForm({ initial, accessToken = null, save = saveWorkAreaAction, setAvailable = setAvailableAction, preview, search = searchArea, suggestions, onRetry, next }: Props) {
  const id = useId();
  const router = useRouter(), toast = useToast(), form = useRef<HTMLFormElement>(null);
  const session = useOptionalSessionExpired();
  const [saved, setSaved] = useState(initial);
  const [value, setValue] = useState<WorkAreaInput>(() => ({ baseSuburb: initial?.baseSuburb ?? "", point: initial?.point ?? null,
    radiusKm: preview === "changed" || preview === "saving" || preview === "error" ? 50 : initial?.radiusKm ?? 25 }));
  const [errors, setErrors] = useState<WorkAreaErrors>(preview === "field-error" ? { baseSuburb: WORK_AREA_SELECTION_ERROR } : {});
  const [failure, setFailure] = useState(preview === "error");
  const [availabilityError, setAvailabilityError] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [busy, setBusy] = useState<"area" | "availability" | null>(null);
  const pending = busy !== null || preview === "saving";
  const online = useOnlineStatus() && preview !== "offline";
  const locked = pending || !online || Boolean(saved?.paused) || forbidden;
  const changed = saved ? workAreaChanged(saved, value) : false;
  const needsArea = saved ? !saved.available && !parseWorkArea(saved).ok : true;
  useEffect(() => { if (preview === "saved") toast.show({ message: "Saved." }); }, [preview, toast]);

  if (preview === "loading") return <WorkAreaLoading />;
  if (!saved) return <><h1 className={account.title}>Work area</h1><ErrorState title="Couldn’t load work area." onRetry={onRetry ?? (() => router.refresh())} /></>;

  async function submit() {
    if (locked || !changed) return;
    const parsed = parseWorkArea(value);
    if (!parsed.ok) {
      setErrors(parsed.fields);
      requestAnimationFrame(() => form.current?.querySelector<HTMLElement>("[aria-invalid=true] input, input[aria-invalid=true]")?.focus());
      return;
    }
    setBusy("area"); setFailure(false); setErrors({});
    try {
      const result = await save(value);
      if (result.ok) { setSaved(result.snapshot); setValue(parsed.data); toast.show({ message: "Saved." }); }
      else if (result.error === "invalid") { setErrors(result.fields); requestAnimationFrame(() => form.current?.querySelector<HTMLElement>("input[aria-invalid=true]")?.focus()); }
      else if (session?.check(result, { resend: () => form.current?.requestSubmit() })) return;
      else { setFailure(true); if (result.error === "forbidden") setForbidden(true); }
    } catch { setFailure(true); }
    finally { setBusy(null); }
  }

  async function changeAvailability(available: boolean) {
    if (locked || available && needsArea) return;
    setBusy("availability"); setAvailabilityError(false);
    try {
      const result = await setAvailable(available);
      if (result.ok) { setSaved(current => current ? { ...current, available: result.snapshot.available } : current); toast.show({ message: "Saved." }); }
      else if (session?.check(result, { resend: () => changeAvailability(available) })) return;
      else if (result.error === "invalid") { setErrors(result.fields); requestAnimationFrame(() => form.current?.querySelector<HTMLElement>("input[aria-invalid=true]")?.focus()); }
      else { setAvailabilityError(true); if (result.error === "forbidden") setForbidden(true); }
    } catch { setAvailabilityError(true); }
    finally { setBusy(null); }
  }

  return <>
    <h1 className={account.title}>Work area</h1>
    <OfflineBanner online={online} sticky={false} />
    {(saved.paused || forbidden) && <Banner tone="alert">Your account is paused. <TextLink href="/contact" inline>Contact us.</TextLink></Banner>}
    <section className={account.card} aria-labelledby={`${id}-work-area-heading`}>
      <h2 id={`${id}-work-area-heading`}>Where you work</h2>
      <form ref={form} className={account.form} aria-label="Work area" noValidate aria-busy={busy === "area" || preview === "saving"} onSubmit={event => { event.preventDefault(); void submit(); }}>
        {failure && <InlineError message="Couldn’t save." onRetry={online && !locked ? submit : undefined} />}
        <WorkerAreaFields value={value} onChange={next => { setValue(next); setErrors({}); }} errors={errors} disabled={locked} requireSelected
          previewAreaState={preview === "search-unavailable" ? "unavailable" : undefined} previewSuggestions={suggestions} search={search} />
        <AreaMap key={`${value.baseSuburb}-${value.radiusKm}-${value.point?.lat}-${value.point?.lng}`} value={value} accessToken={preview === "map-unavailable" ? null : accessToken} />
        <div><Button type="submit" loading={busy === "area" || preview === "saving"} disabled={locked || !changed}>Save changes</Button></div>
      </form>
    </section>
    <section className={`${account.card} ${styles.card}`} aria-labelledby={`${id}-availability-heading`}>
      <h2 id={`${id}-availability-heading`}>Available for jobs</h2>
      <SwitchField label="Available for jobs" checked={saved.available} disabled={saved.paused || forbidden || needsArea} aria-disabled={pending || !online || undefined}
        onClick={event => { if (locked) event.preventDefault(); }} onChange={event => void changeAvailability(event.target.checked)} aria-describedby={`${id}-availability-description`} />
      <p id={`${id}-availability-description`} className={account.hint}>{saved.available ? "You’ll see jobs and get alerts." : "You won’t get job alerts."}</p>
      {needsArea && <p className={account.hint}>Save your work area before turning on job alerts.</p>}
      {availabilityError && <InlineError message="Couldn’t save." onRetry={online && !locked ? () => changeAvailability(!saved.available) : undefined} />}
    </section>
    <section className={`${account.card} ${styles.card}`} aria-labelledby={`${id}-trades-heading`}>
      <h2 id={`${id}-trades-heading`}>Your trades</h2>
      {saved.trades.length ? <ul className={styles.trades} aria-label="Verified trades">{saved.trades.map(trade => <li key={trade}>{tradeLabel(trade)}</li>)}</ul> : <p className={account.hint}>No checked trades yet.</p>}
      <TextLink href={boardSettingsRoute("/profile/trades", next).href}>Trades &amp; licences</TextLink>
    </section>
    <section className={`${account.card} ${styles.card}`} aria-labelledby={`${id}-alerts-heading`}>
      <h2 id={`${id}-alerts-heading`}>Job alerts</h2>
      <p className={account.hint}>Choose how we tell you about new jobs.</p>
      <TextLink href={boardSettingsRoute("/profile/notifications", next).href}>Notification settings</TextLink>
    </section>
    <LiveMessage message={pending ? "Saving…" : null} />
  </>;
}

function AreaMap({ value, accessToken }: { value: WorkAreaInput; accessToken: string | null }) {
  const [failed, setFailed] = useState(false), [viewport, setViewport] = useState<MapboxViewport | null>(null);
  const area = useMemo(() => value.point ? { name: value.baseSuburb, centre: value.point, radiusKm: Number(value.radiusKm) } : null, [value]);
  const config = useMemo(() => area ? { accessToken, workArea: area } : null, [accessToken, area]);
  if (!config || failed || !accessToken) return <p className={styles.mapFallback}>{value.baseSuburb || "Suburb or town"} · {value.radiusKm} km</p>;
  const centre = viewport?.project(config.workArea.centre);
  const bounds = workAreaBounds(config.workArea);
  const width = viewport ? Math.min(100, (bounds.east - bounds.west) / (viewport.bounds.east - viewport.bounds.west) * 100) : 0;
  return <div className={styles.map}>
    <MapboxSurface config={config} label={`${value.baseSuburb} · ${value.radiusKm} km`} onViewChange={setViewport} onFailure={() => setFailed(true)}>
      {centre && <><ApproxArea position={centre} widthPct={width} /><span className={styles.centre} style={{ left: `${centre.x}%`, top: `${centre.y}%` }} aria-hidden="true" /></>}
    </MapboxSurface>
  </div>;
}
