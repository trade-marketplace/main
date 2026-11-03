"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/Button";
import { AddressField } from "@/components/forms/AddressField";
import { TextAreaField, TextField } from "@/components/forms/TextFields";
import { editWhere, whereInputs, type WizardDraft } from "@/lib/post-job-wizard";
import type { AddressSearchResult } from "@/server/geo/address-search";
import { searchJobAddressesAction } from "@/server/jobs/address-actions";
import { ScheduleFields } from "./ScheduleFields";
import styles from "./post-job.module.css";

type SearchSuggestion = Extract<AddressSearchResult, { mode: "search" }>["suggestions"][number];
type Lookup = { status: "idle" | "loading" | "ready" | "error"; suggestions: SearchSuggestion[] };
export function DraftWhere({ draft, onChange, onNext, onOutside, backHref, now, fields, busy, offline, search = searchJobAddressesAction, preview }: {
  draft: WizardDraft; onChange(draft: WizardDraft): void; onNext(): void; onOutside(draft: WizardDraft, suggestion: SearchSuggestion): void;
  backHref: string; now: Date; fields: Record<string, string>; busy: boolean; offline: boolean;
  search?: typeof searchJobAddressesAction; preview?: { status?: Lookup["status"]; suggestions?: SearchSuggestion[]; manual?: boolean };
}) {
  const values = whereInputs(draft); const initialSelected = draft.data.locationSource === "SEARCH";
  const [query, setQuery] = useState(() => initialSelected ? [values.addressLine1, values.suburb, values.city].filter(Boolean).join(", ") : values.addressLine1);
  const [selected, setSelected] = useState(initialSelected);
  const [manual, setManual] = useState(preview?.manual ?? draft.data.locationSource === "TYPED");
  const [lookup, setLookup] = useState<Lookup>({ status: preview?.status ?? "idle", suggestions: preview?.suggestions ?? [] });
  const sequence = useRef(0);
  useEffect(() => {
    if (preview || selected || query.trim().length < 3) return;
    const id = ++sequence.current;
    const timeout = setTimeout(() => {
      if (offline) { setManual(true); setLookup({ status: "error", suggestions: [] }); return; }
      setLookup({ status: "loading", suggestions: [] });
      void search(query).then(result => {
        if (id !== sequence.current) return;
        if (result.mode === "manual") { setManual(true); setLookup({ status: "error", suggestions: [] }); }
        else { setLookup({ status: "ready", suggestions: result.suggestions }); if (!result.suggestions.length) setManual(true); }
      }, () => { if (id === sequence.current) { setManual(true); setLookup({ status: "error", suggestions: [] }); } });
    }, 250);
    return () => { clearTimeout(timeout); sequence.current++; };
  }, [query, selected, search, offline, preview]);

  function pick(suggestion: SearchSuggestion) {
    const next = editWhere(draft, { addressLine1: suggestion.line1, suburb: suggestion.suburb, city: suggestion.city, postcode: suggestion.postcode ?? "" }, { locationSource: "SEARCH", point: suggestion.point });
    setQuery(suggestion.label); setSelected(true); setManual(false); sequence.current++; onChange(next);
    if (suggestion.coverage.status === "outside") onOutside(next, suggestion);
  }
  return <form className={`${styles.form} ${styles.whereForm}`} onSubmit={event => { event.preventDefault(); onNext(); }} noValidate aria-label="Where and when">
    <AddressField id="job-address" name="address" label="Address" hint="Only shared with the person who takes the job." value={query} maxLength={200} required readOnly={busy}
      autoComplete="street-address" error={fields.addressLine1 ?? fields.point ?? fields.locationSource} suggestions={lookup.suggestions} status={lookup.status}
      onQueryChange={value => { setQuery(value); setSelected(false); sequence.current++; setLookup({ status: "idle", suggestions: [] }); onChange(editWhere(draft, { addressLine1: value }, { locationSource: "TYPED", point: undefined })); }}
      onSelect={option => { const suggestion = lookup.suggestions.find(value => value.id === option.id); if (suggestion) pick(suggestion); }} />
    <TextField id="job-unit" name="addressLine2" label="Unit / flat (optional)" value={values.addressLine2} maxLength={200} autoComplete="address-line2" readOnly={busy}
      error={fields.addressLine2} onChange={event => onChange(editWhere(draft, { addressLine2: event.target.value }))} />
    {manual && <div className={styles.manualAddress}>
      <TextField id="job-suburb" name="suburb" label="Suburb" value={values.suburb} maxLength={100} autoComplete="address-level2" required readOnly={busy} error={fields.suburb} onChange={event => onChange(editWhere(draft, { suburb: event.target.value }))} />
      <TextField id="job-city" name="city" label="City" value={values.city} maxLength={100} autoComplete="address-level1" required readOnly={busy} error={fields.city} onChange={event => onChange(editWhere(draft, { city: event.target.value }))} />
      <TextField id="job-postcode" name="postcode" label="Postcode (optional)" value={values.postcode} maxLength={4} inputMode="numeric" autoComplete="postal-code" readOnly={busy} error={fields.postcode} onChange={event => onChange(editWhere(draft, { postcode: event.target.value }))} />
    </div>}
    <ScheduleFields now={now} value={draft.data} disabled={busy} error={fields.timeWindows} onChange={schedule => onChange({ ...draft, data: { ...draft.data, ...schedule }, completedWhere: false })} />
    <TextAreaField id="job-access" name="accessNotes" label="Anything else? (optional)" rows={3} value={values.accessNotes} maxLength={1000} readOnly={busy} error={fields.accessNotes} onChange={event => onChange(editWhere(draft, { accessNotes: event.target.value }))} />
    <div className={`${styles.actions} ${styles.photoActions}`}><Button href={backHref} variant="tertiary" width="auto">Back</Button><Button type="submit" loading={busy} disabled={offline} width="full-on-phone">Next</Button></div>
  </form>;
}
