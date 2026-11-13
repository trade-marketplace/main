"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOptionalSessionExpired } from "@/components/auth/SessionExpired";
import { InlineError } from "@/components/feedback";
import { RadioGroup } from "@/components/forms";
import { TextLink } from "@/components/TextLink";
import type { SavedAddress } from "@/lib/account/addresses";
import type { JobDraft } from "@/lib/job-draft";
import { copyDraftAddressAction, listDraftAddressesAction } from "@/server/jobs/posting-actions";
import { Button } from "@/components/Button";
import { AddressField } from "@/components/forms/AddressField";
import { TextAreaField, TextField } from "@/components/forms/TextFields";
import { editWhere, whereInputs, type WizardDraft } from "@/lib/post-job-wizard";
import type { AddressSearchResult } from "@/server/geo/address-search";
import { searchJobAddressesAction } from "@/server/jobs/address-actions";
import { ScheduleFields } from "./ScheduleFields";
import styles from "./post-job.module.css";

type SearchSuggestion = Extract<AddressSearchResult, { mode: "search" }>["suggestions"][number];
export type CopiedAddress = Pick<JobDraft, "addressLine1" | "addressLine2" | "suburb" | "city" | "postcode" | "locationSource" | "point">;
type SavedPreview = { addresses: SavedAddress[]; selectedId?: string; error?: boolean; loadError?: boolean; copy(id: string): Promise<{ status: "saved"; address: CopiedAddress } | { status: "unavailable" }> };
export function savedAddressMatches(draft: WizardDraft, address: SavedAddress) {
  const values = whereInputs(draft);
  return values.addressLine1 === address.line1 && values.addressLine2 === (address.line2 ?? "") && values.suburb === address.suburb && values.city === address.city && values.postcode === (address.postcode ?? "") && draft.data.locationSource === address.locationSource && (draft.data.point?.lat ?? null) === address.lat && (draft.data.point?.lng ?? null) === address.lng;
}
type Lookup = { status: "idle" | "loading" | "ready" | "error"; suggestions: SearchSuggestion[] };
export function DraftWhere({ draft, onChange, onNext, onOutside, backHref, now, fields, busy, offline, search = searchJobAddressesAction, preview }: {
  draft: WizardDraft; onChange(draft: WizardDraft): void; onNext(): void; onOutside(draft: WizardDraft, suggestion: SearchSuggestion): void;
  backHref: string; now: Date; fields: Record<string, string>; busy: boolean; offline: boolean;
  search?: typeof searchJobAddressesAction; preview?: { status?: Lookup["status"]; suggestions?: SearchSuggestion[]; manual?: boolean; saved?: SavedPreview };
}) {
  const values = whereInputs(draft); const selected = draft.data.locationSource === "SEARCH";
  const [picked, setPicked] = useState<SearchSuggestion>();
  const query = !selected ? values.addressLine1 : picked && picked.line1 === values.addressLine1 && picked.suburb === values.suburb && picked.city === values.city ? picked.label : [values.addressLine1, values.suburb, values.city].filter(Boolean).join(", ");
  const [useHint, setUseHint] = useState(() => !values.addressLine1);
  const hint = useHint ? draft.locationHint : undefined;
  const [manualFallback, setManual] = useState(preview?.manual ?? false);
  const manual = manualFallback || !preview && draft.data.locationSource === "TYPED";
  const [lookup, setLookup] = useState<Lookup>({ status: preview?.status ?? "idle", suggestions: preview?.suggestions ?? [] });
  const sequence = useRef(0);
  const session = useOptionalSessionExpired();
  const current = useRef(draft); const mounted = useRef(true); const initialized = useRef(Boolean(preview));
  const [saved, setSaved] = useState<{ status: "loaded"; addresses: SavedAddress[]; ownerId: string | null } | { status: "unavailable" }>();
  const [refresh, setRefresh] = useState(0);
  const [savedId, setSavedId] = useState(preview?.saved?.selectedId ?? "other");
  const [copying, setCopying] = useState(""); const [attempt, setAttempt] = useState(preview?.saved?.selectedId ?? ""); const [copyError, setCopyError] = useState(Boolean(preview?.saved?.error)); const copyPending = useRef(false); const retryChoice = useRef<(id: string) => Promise<void>>(async () => {});
  useEffect(() => { current.current = draft; }, [draft]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (preview) return;
    let active = true;
    void listDraftAddressesAction().then(result => { if (active) setSaved("status" in result ? result : { status: "loaded", addresses: [], ownerId: null }); }, () => { if (active) setSaved({ status: "unavailable" }); });
    return () => { active = false; };
  }, [preview, refresh]);
  const [previewLoadFailure, setPreviewLoadFailure] = useState(Boolean(preview?.saved?.loadError));
  const choices = useMemo(() => previewLoadFailure ? [] : preview?.saved?.addresses ?? (saved?.status === "loaded" ? saved.addresses : []), [preview, saved, previewLoadFailure]);
  const choose = useCallback(async (id: string) => {
    if (busy || copyPending.current || offline) return;
    setCopyError(false); setAttempt(id);
    if (id === "other") {
      setSavedId(id); setManual(true); setPicked(undefined); sequence.current++; setLookup({ status: "idle", suggestions: [] });
      onChange(editWhere(current.current, { addressLine1: "", addressLine2: "", suburb: "", city: "", postcode: "" }, { locationSource: "TYPED", point: undefined }));
      return;
    }
    copyPending.current = true; setCopying(id);
    try {
      const result = preview?.saved ? await preview.saved.copy(id) : await copyDraftAddressAction(id, current.current.data.postKey ?? "", saved?.status === "loaded" ? saved.ownerId ?? "" : "");
      if (!mounted.current || session?.check(result, { resend: () => retryChoice.current(id) })) return;
      if (!("status" in result) || result.status !== "saved") { setCopyError(true); return; }
      const address = result.address;
      const next = editWhere(current.current, { addressLine1: address.addressLine1 ?? "", addressLine2: address.addressLine2 ?? "", suburb: address.suburb ?? "", city: address.city ?? "", postcode: address.postcode ?? "" }, { locationSource: address.locationSource, point: address.point });
      setSavedId(id); setUseHint(false); setPicked(undefined); setManual(address.locationSource === "TYPED"); sequence.current++; setLookup({ status: "idle", suggestions: [] }); onChange(next);
    } catch { if (mounted.current) setCopyError(true); }
    finally { copyPending.current = false; if (mounted.current) setCopying(""); }
  }, [busy, offline, onChange, preview, saved, session]);
  useEffect(() => { retryChoice.current = choose; }, [choose]);
  useEffect(() => {
    if (initialized.current || saved?.status !== "loaded") return;
    initialized.current = true;
    const existing = choices.find(address => savedAddressMatches(current.current, address));
    if (whereInputs(current.current).addressLine1) setSavedId(existing?.id ?? "other");
    else { const initial = choices.find(address => address.isDefault); if (initial) void choose(initial.id); }
  }, [saved, choices, choose]);
  const locked = busy || Boolean(copying);
  const usingSaved = choices.length > 0 && savedId !== "other";
  useEffect(() => {
    if (preview || usingSaved || selected || query.trim().length < 3) return;
    const id = ++sequence.current;
    let cancelled = false;
    const timeout = setTimeout(() => {
      if (offline) { setManual(true); setLookup({ status: "error", suggestions: [] }); return; }
      setLookup({ status: "loading", suggestions: [] });
      void search(query, hint).then(result => {
        if (cancelled || id !== sequence.current) return;
        if (result.mode === "manual") { setManual(true); setLookup({ status: "error", suggestions: [] }); }
        else { setLookup({ status: "ready", suggestions: result.suggestions }); if (!result.suggestions.length) setManual(true); }
      }, () => { if (!cancelled && id === sequence.current) { setManual(true); setLookup({ status: "error", suggestions: [] }); } });
    }, 250);
    return () => { cancelled = true; clearTimeout(timeout); };
  }, [query, selected, search, offline, preview, hint, usingSaved]);

  function pick(suggestion: SearchSuggestion) {
    const next = editWhere(draft, { addressLine1: suggestion.line1, suburb: suggestion.suburb, city: suggestion.city, postcode: suggestion.postcode ?? "" }, { locationSource: "SEARCH", point: suggestion.point });
    setUseHint(false); setPicked(suggestion); setManual(false); sequence.current++; onChange(next);
    if (suggestion.coverage.status === "outside") onOutside(next, suggestion);
  }
  return <form className={`${styles.form} ${styles.whereForm}`} onSubmit={event => { event.preventDefault(); if (!locked) onNext(); }} noValidate aria-label="Where and when">
    {choices.length > 0 && <div className={styles.savedAddresses}>
      <RadioGroup label="Address" name="saved-job-address" value={copying || savedId} disabled={locked || offline} onChange={id => void choose(id)} options={[...choices.map(address => ({ value: address.id, label: address.label || address.line1, hint: [address.line2, address.line1, address.suburb].filter(Boolean).join(", ") })), { value: "other", label: "Somewhere else" }]} />
      <TextLink href="/profile/addresses">Manage addresses</TextLink>
    </div>}
    {(saved?.status === "unavailable" || previewLoadFailure) && <InlineError message="Couldn’t load saved addresses." onRetry={() => { setPreviewLoadFailure(false); setRefresh(value => value + 1); }} />}
    {copyError && <InlineError message="Couldn’t use that address. Try again." onRetry={() => void choose(attempt)} />}
    {!usingSaved && <><AddressField id="job-address" name="address" label="Address" hint="Only shared with the person who takes the job." hintVisible value={query} maxLength={200} required readOnly={locked}
      autoComplete="street-address" placeholder={hint?.label} error={fields.addressLine1 ?? fields.point ?? fields.locationSource} suggestions={lookup.suggestions} status={lookup.status}
      onQueryChange={value => { setPicked(undefined); sequence.current++; setLookup({ status: "idle", suggestions: [] }); onChange(editWhere(draft, { addressLine1: value }, { locationSource: "TYPED", point: undefined })); }}
      onSelect={option => { const suggestion = lookup.suggestions.find(value => value.id === option.id); if (suggestion) pick(suggestion); }} />
    <TextField id="job-unit" name="addressLine2" label="Unit / flat (optional)" value={values.addressLine2} maxLength={200} autoComplete="address-line2" readOnly={locked}
      error={fields.addressLine2} onChange={event => onChange(editWhere(draft, { addressLine2: event.target.value }))} />
    {manual && <div className={styles.manualAddress}>
      <TextField id="job-suburb" name="suburb" label="Suburb" value={values.suburb} maxLength={100} autoComplete="address-level2" required readOnly={locked} error={fields.suburb} onChange={event => onChange(editWhere(draft, { suburb: event.target.value }))} />
      <TextField id="job-city" name="city" label="City" value={values.city} maxLength={100} autoComplete="address-level1" required readOnly={locked} error={fields.city} onChange={event => onChange(editWhere(draft, { city: event.target.value }))} />
      <TextField id="job-postcode" name="postcode" label="Postcode (optional)" value={values.postcode} maxLength={4} inputMode="numeric" autoComplete="postal-code" readOnly={locked} error={fields.postcode} onChange={event => onChange(editWhere(draft, { postcode: event.target.value }))} />
    </div>}
    </>}
    <ScheduleFields now={now} value={draft.data} disabled={locked} error={fields.timeWindows} onChange={schedule => { const next = editWhere(draft, {}); onChange({ ...next, data: { ...next.data, ...schedule }, completedWhere: false }); }} />
    <TextAreaField id="job-access" name="accessNotes" label="Anything else? (optional)" rows={3} value={values.accessNotes} maxLength={1000} readOnly={locked} error={fields.accessNotes} onChange={event => onChange(editWhere(draft, { accessNotes: event.target.value }))} />
    <div className={`${styles.actions} ${styles.photoActions}`}><Button href={backHref} variant="secondary" width="auto">Back</Button><Button type="submit" loading={locked} disabled={offline || Boolean(copying)} width="full-on-phone">Next</Button></div>
  </form>;
}
