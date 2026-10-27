"use client";

import { useEffect, useRef, useState } from "react";

import { AddressField } from "@/components/forms/AddressField";
import { ChipGroup } from "@/components/forms/ChoiceFields";
import { TextField } from "@/components/forms/TextFields";
import { Banner } from "@/components/overlays/Banner";
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
  const [suburb, setSuburb] = useState(values.baseSuburb ?? "");
  const [radius, setRadius] = useState(values.radiusKm || "25");
  const [chosen, setChosen] = useState<SignupAreaSuggestion | null>(values.areaLat && values.areaLng ? { id: "saved", label: values.baseSuburb, point: { lat: Number(values.areaLat), lng: Number(values.areaLng) } } : null);
  const [lookup, setLookup] = useState<{ status: "idle" | "loading" | "ready" | "error"; result?: SignupAreaResult }>({ status: "idle" });
  const request = useRef(0);
  const areaRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (previewSuggestions) areaRef.current?.focus({ preventScroll: true });
  }, [previewSuggestions]);

  useEffect(() => {
    const sequence = ++request.current;
    if (suburb.trim().length < 3 || chosen?.label === suburb || previewAreaState || previewSuggestions) return;
    const timer = setTimeout(async () => {
      setLookup({ status: "loading" });
      try {
        const result = await searchSignupAreasAction(suburb);
        if (sequence === request.current) setLookup({ status: result.mode === "search" ? "ready" : "error", result });
      } catch {
        if (sequence === request.current) setLookup({ status: "error" });
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [suburb, chosen, previewAreaState, previewSuggestions]);

  const results = previewSuggestions ?? (lookup.result?.mode === "search" ? lookup.result.suggestions : []);
  const status = previewAreaState === "unavailable" ? "error" : previewAreaState === "loading" ? "loading" : previewSuggestions ? "ready" : suburb.length < 3 ? "idle" : lookup.status;
  const onlyOther = trades.length === 1 && trades[0] === "OTHER";

  return (
    <div className={styles.workerFields}>
      <ChipGroup key={`trades-${attempt}`} name="trades" label="What do you do?" hint="Pick all that apply." multiple required
        options={SIGNUP_TRADES.map((trade) => ({ value: trade.value, label: trade.label }))} value={trades} onChange={setTrades} error={errors.trades} />
      {SIGNUP_TRADES.map((trade) => trade.licence && trades.includes(trade.value) && <TextField key={trade.value} name={`licence_${trade.value}`}
        label={trade.licence.label} placeholder={trade.licence.example} value={licences[trade.value]} onChange={(event) => setLicences({ ...licences, [trade.value]: event.target.value })}
        maxLength={64} required error={errors[`licence_${trade.value}`]} hint="Saved for office checking. This does not verify your licence." autoComplete="off" />)}
      {onlyOther && <p className={styles.draftNote}>Other / general labour needs no licence. Confirm your email and phone before taking Other jobs.</p>}
      <AddressField name="baseSuburb" label="Where do you work?" placeholder="Suburb or town" value={suburb} required maxLength={120}
        error={errors.baseSuburb} ref={areaRef} suggestions={results} status={status} lookupError="Suburb search is unavailable. Type your suburb or town by hand."
        onQueryChange={(query) => { setSuburb(query); setChosen(null); setLookup({ status: "idle" }); }}
        onSelect={(suggestion) => setChosen(results.find((place) => place.id === suggestion.id) ?? null)} />
      <input type="hidden" name="areaLat" value={chosen ? String(chosen.point.lat) : ""} />
      <input type="hidden" name="areaLng" value={chosen ? String(chosen.point.lng) : ""} />
      <ChipGroup key={`radius-${attempt}`} name="radiusKm" label="Travel radius" options={[10, 25, 50].map((km) => ({ value: String(km), label: `${km} km` }))}
        value={radius} onChange={setRadius} required error={errors.radiusKm} />
      <Banner tone="brand" icon="verified_user">Browse jobs straight away. Confirm your email before taking a job. Restricted work also needs a licence checked by the office.</Banner>
    </div>
  );
}
