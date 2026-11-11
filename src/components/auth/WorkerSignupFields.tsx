"use client";

import { useEffect, useRef, useState } from "react";

import { AddressField } from "@/components/forms/AddressField";
import { ChipGroup } from "@/components/forms/ChoiceFields";
import { TextField } from "@/components/forms/TextFields";
import { Banner } from "@/components/overlays/Banner";
import { Button } from "@/components/Button";
import { SIGNUP_TRADES, type WorkerSignupField } from "@/lib/auth/worker-signup";
import { searchSignupAreasAction } from "@/server/auth/actions";
import type { SignupAreaResult, SignupAreaSuggestion } from "@/server/auth/work-area";

import styles from "./auth.module.css";

export type WorkerSignupFieldsProps = {
  values?: Record<string, string>;
  errors?: Partial<Record<WorkerSignupField, string>>;
  attempt: number;
  previewAreaState?: "loading" | "unavailable";
  previewSuggestions?: SignupAreaSuggestion[];
};

export function WorkerSignupFields({ values = {}, errors = {}, attempt, previewAreaState, previewSuggestions }: WorkerSignupFieldsProps) {
  const [trades, setTrades] = useState<string[]>(values.trades?.split(",").filter(Boolean) ?? []);
  const [licences, setLicences] = useState<Record<string, string>>(Object.fromEntries(SIGNUP_TRADES.map((trade) => [trade.value, values[`licence_${trade.value}`] ?? ""])));
  const [area, setArea] = useState<WorkerAreaValue>({ baseSuburb: values.baseSuburb ?? "", radiusKm: values.radiusKm || "25", point: values.areaLat && values.areaLng ? { lat: Number(values.areaLat), lng: Number(values.areaLng) } : null });
  const onlyOther = trades.length === 1 && trades[0] === "OTHER";

  return (
    <div className={styles.workerFields}>
      <ChipGroup key={`trades-${attempt}`} name="trades" label="What do you do?" hint="Pick all that apply." multiple required
        options={SIGNUP_TRADES.map((trade) => ({ value: trade.value, label: trade.label }))} value={trades} onChange={setTrades} error={errors.trades} />
      {SIGNUP_TRADES.map((trade) => trade.licence && trades.includes(trade.value) && <TextField key={trade.value} name={`licence_${trade.value}`}
        label={trade.licence.label} placeholder={trade.licence.example} value={licences[trade.value]} onChange={(event) => setLicences({ ...licences, [trade.value]: event.target.value })}
        maxLength={64} required error={errors[`licence_${trade.value}`]} autoComplete="off" />)}
      {onlyOther && <p className={styles.draftNote}>Other / general labour needs no licence. Confirm your email and phone before taking Other jobs.</p>}
      <WorkerAreaFields value={area} onChange={setArea} errors={errors} attempt={attempt} previewAreaState={previewAreaState} previewSuggestions={previewSuggestions} />
      <Banner tone="brand" icon="verified_user">Browse jobs straight away. Confirm your email before taking a job. Restricted work also needs a licence checked by the office.</Banner>
    </div>
  );
}

export type WorkerAreaValue = { baseSuburb: string; radiusKm: string | number; point: { lat: number; lng: number } | null };
export function WorkerAreaFields({ value, onChange, errors = {}, attempt = 0, lookupAttempt = 0, disabled, previewAreaState, previewSuggestions, search = searchSignupAreasAction, requireSelected = false }: {
  value: WorkerAreaValue; onChange: (value: WorkerAreaValue) => void; errors?: Partial<Record<WorkerSignupField, string>>; attempt?: number; disabled?: boolean;
  previewAreaState?: "loading" | "unavailable"; previewSuggestions?: SignupAreaSuggestion[]; search?: (query: string) => Promise<SignupAreaResult>;
  requireSelected?: boolean; lookupAttempt?: number;
}) {
  const suburb = value.baseSuburb, radius = String(value.radiusKm);
  const chosen = value.point;
  const [lookup, setLookup] = useState<{ status: "idle" | "loading" | "ready" | "error"; result?: SignupAreaResult }>({ status: "idle" });
  const [retry, setRetry] = useState(0);
  const lastRetry = useRef(0);
  const request = useRef(0);
  const areaRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (previewSuggestions) areaRef.current?.focus({ preventScroll: true });
  }, [previewSuggestions]);

  useEffect(() => {
    const sequence = ++request.current;
    const retrying = retry !== lastRetry.current;
    lastRetry.current = retry;
    if (suburb.trim().length < 3 || chosen !== null && !retrying || previewAreaState && !retry || previewSuggestions) return;
    const timer = setTimeout(async () => {
      setLookup({ status: "loading" });
      try {
        const result = await search(suburb);
        if (sequence === request.current) setLookup({ status: result.mode === "search" ? "ready" : "error", result });
      } catch {
        if (sequence === request.current) setLookup({ status: "error" });
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [suburb, chosen, previewAreaState, previewSuggestions, search, retry, lookupAttempt]);

  const results = previewSuggestions ?? (lookup.result?.mode === "search" ? lookup.result.suggestions : []);
  const noMatches = requireSelected && lookup.status === "ready" && results.length === 0;
  const status = previewAreaState === "unavailable" && !retry ? "error" : previewAreaState === "loading" && !retry ? "loading" : previewSuggestions ? "ready" : suburb.length < 3 ? "idle" : noMatches ? "error" : lookup.status;
  return <>
      <AddressField name="baseSuburb" label="Where do you work?" placeholder="Suburb or town" value={suburb} disabled={disabled} required maxLength={120}
        error={errors.baseSuburb} ref={areaRef} suggestions={results} status={status} lookupError={noMatches ? "No suburb found. Try again or search another suburb." : requireSelected ? "Suburb search is unavailable. Try again to choose a suburb." : "Suburb search is unavailable. Type your suburb or town by hand."}
        onQueryChange={(query) => { onChange({ ...value, baseSuburb: query, point: null }); setLookup({ status: "idle" }); }}
        onSelect={(suggestion) => { const selected = results.find(place => place.id === suggestion.id); if (selected) onChange({ ...value, baseSuburb: selected.label, point: selected.point }); }} />
      {requireSelected && status === "error" && <div><Button variant="tertiary" disabled={disabled} onClick={() => { setLookup({ status: "loading" }); setRetry(current => current + 1); }}>Try again</Button></div>}
      <input type="hidden" name="areaLat" value={chosen ? String(chosen.lat) : ""} />
      <input type="hidden" name="areaLng" value={chosen ? String(chosen.lng) : ""} />
      <ChipGroup key={`radius-${attempt}`} name="radiusKm" label="Travel radius" disabled={disabled} options={[10, 25, 50].map((km) => ({ value: String(km), label: `${km} km` }))}
        value={radius} onChange={radiusKm => onChange({ ...value, radiusKm })} required error={errors.radiusKm} />
  </>;
}
