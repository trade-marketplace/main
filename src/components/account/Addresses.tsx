"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/Button";
import { useOptionalSessionExpired } from "@/components/auth/SessionExpired";
import { EmptyState, ErrorState, InlineError, LoadingRegion, OfflineBanner, Skeleton, useOnlineStatus } from "@/components/feedback";
import { AddressField } from "@/components/forms/AddressField";
import { TextField } from "@/components/forms/TextFields";
import { Dialog } from "@/components/overlays/Dialog";
import { ToastProvider, useToast } from "@/components/overlays/Toast";
import { Pill } from "@/components/status/Pill";
import { ADDRESS_STATES, MAX_SAVED_ADDRESSES, addressInput, addressLines, parseAddress, type AddressFields, type AddressInput, type AddressResult, type AddressSource, type AddressState, type SavedAddress } from "@/lib/account/addresses";
import { EXIT_MS } from "@/lib/motion/timings";
import { deleteAddressAction, listAddressesAction, saveAddressAction, setDefaultAddressAction } from "@/server/account/address-actions";
import type { AddressSearchResult } from "@/server/geo/address-search";
import { searchJobAddressesAction } from "@/server/jobs/address-actions";

import account from "./account.module.css";
import styles from "./addresses.module.css";

type Suggestion = Extract<AddressSearchResult, { mode: "search" }>["suggestions"][number];
type Lookup = { status: "idle" | "loading" | "ready" | "error"; suggestions: Suggestion[] };
type Props = { initial: SavedAddress[] | null; source?: AddressSource; search?: typeof searchJobAddressesAction; preview?: AddressState; previewInput?: AddressInput; headingLevel?: 1 | 2 };
const live: AddressSource = { list: listAddressesAction, save: saveAddressAction, delete: deleteAddressAction, makeDefault: setDefaultAddressAction };
const errors = { invalid: "Check the highlighted fields.", forbidden: "This address isn’t available.", limit: "You can save up to 10 addresses.", unavailable: "Couldn’t save your addresses. Try again.", "session-expired": "Log in again to save your addresses." };

export function AddressesLoading({ headingLevel = 1 }: { headingLevel?: 1 | 2 }) {
  const Heading = headingLevel === 1 ? "h1" : "h2";
  return <><Heading className={account.title}>Addresses</Heading><LoadingRegion loading label="Loading addresses" skeleton={<div className={styles.list}>
    {[0, 1].map(item => <div className={account.card} key={item}><Skeleton width="35%" height={24} /><div className={styles.skeleton}><Skeleton width="70%" height={18} /><Skeleton width="60%" height={18} /></div></div>)}
  </div>} /></>;
}
export function Addresses(props: Props) {
  return <ToastProvider initial={props.preview === "saved" ? { message: "Saved." } : undefined}><AddressList {...props} /></ToastProvider>;
}
function AddressList({ initial, source = live, search = searchJobAddressesAction, preview, previewInput, headingLevel = 1 }: Props) {
  const [addresses, setAddresses] = useState(initial ?? []), [loadError, setLoadError] = useState(initial === null || preview === "error");
  const [dialog, setDialog] = useState<"add" | "edit" | "delete" | null>(() => preview === "delete-dialog" ? "delete" : preview && ["add-dialog", "searching", "search-unavailable", "field-error", "saving"].includes(preview) ? "add" : null);
  const [selected, setSelected] = useState<SavedAddress | undefined>(() => preview === "delete-dialog" ? initial?.[0] : undefined);
  const [input, setInput] = useState<AddressInput>(() => previewInput ?? addressInput());
  const [lookup, setLookup] = useState<Lookup>({ status: preview === "searching" ? "loading" : preview === "search-unavailable" ? "error" : "idle", suggestions: [] });
  const [manual, setManual] = useState(preview === "search-unavailable" || preview === "field-error"), [fields, setFields] = useState<AddressFields>(preview === "field-error" ? { line1: "Enter the address.", suburb: "Enter the suburb.", city: "Enter the city." } : {});
  const [failure, setFailure] = useState<Extract<AddressResult, { ok: false }> | null>(null), [busy, setBusy] = useState(false), [restoreSelector, setRestoreSelector] = useState<string | null>(null);
  const createRequest = useRef<string | null>(null);
  const sequence = useRef(0), inFlight = useRef(false), root = useRef<HTMLDivElement>(null), form = useRef<HTMLFormElement>(null), id = useId();
  const online = useOnlineStatus(), toast = useToast(), session = useOptionalSessionExpired();
  const offline = !online || preview === "offline", pending = busy || preview === "saving";
  const Heading = headingLevel === 1 ? "h1" : "h2";

  useEffect(() => {
    if (!restoreSelector || dialog) return;
    const timer = setTimeout(() => { root.current?.querySelector<HTMLElement>(restoreSelector)?.focus({ preventScroll: true }); setRestoreSelector(null); }, Math.max(EXIT_MS.dialog, EXIT_MS.sheet) + 1);
    return () => clearTimeout(timer);
  }, [restoreSelector, dialog]);
  useEffect(() => {
    if (!dialog || dialog === "delete" || input.locationSource === "SEARCH" || input.locationSource === null || input.line1.trim().length < 3 || preview === "searching" || preview === "search-unavailable") return;
    let cancelled = false; const request = ++sequence.current;
    const timer = setTimeout(() => {
      if (offline) { setManual(true); setLookup({ status: "error", suggestions: [] }); return; }
      setLookup({ status: "loading", suggestions: [] });
      void search(input.line1).then(answer => {
        if (cancelled || request !== sequence.current) return;
        if (answer.mode === "manual") { setManual(true); setLookup({ status: "error", suggestions: [] }); }
        else { setLookup({ status: "ready", suggestions: answer.suggestions }); if (!answer.suggestions.length) setManual(true); }
      }, () => { if (!cancelled && request === sequence.current) { setManual(true); setLookup({ status: "error", suggestions: [] }); } });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [input.line1, input.locationSource, dialog, search, offline, preview]);

  function open(mode: "add" | "edit" | "delete", address?: SavedAddress) {
    if (pending || offline || mode === "add" && addresses.length >= MAX_SAVED_ADDRESSES) return;
    sequence.current++; createRequest.current = null; setSelected(address); setInput(addressInput(address)); setFields({}); setFailure(null); setLookup({ status: "idle", suggestions: [] });
    setManual(address?.locationSource === "TYPED"); setDialog(mode);
  }
  function closeDialog(removed = false) {
    setRestoreSelector(removed || dialog === "add" || !selected ? "[data-address-add]" : `[data-address-id="${selected.id}"] [data-address-action="${dialog === "edit" ? "edit" : "delete"}"]`);
    setDialog(null);
  }
  async function receive(run: () => Promise<AddressResult>, after: (rows: SavedAddress[]) => void) {
    if (pending || offline || inFlight.current) return;
    inFlight.current = true; setBusy(true); setFailure(null);
    let answer: AddressResult;
    try { answer = await run(); } catch { answer = { ok: false, error: "unavailable" }; }
    inFlight.current = false; setBusy(false);
    if (session?.check(answer)) return;
    if (answer.ok) { setAddresses(answer.addresses); setLoadError(false); after(answer.addresses); toast.show({ message: "Saved." }); }
    else { setFailure(answer); setFields(answer.fields ?? {}); requestAnimationFrame(() => form.current?.querySelector<HTMLElement>("[aria-invalid=true]")?.focus()); }
  }
  function save() {
    if (dialog !== "add" && dialog !== "edit" || pending || offline) return;
    const submitted = input.id ? input : { ...input, requestId: createRequest.current ??= crypto.randomUUID() };
    const parsed = parseAddress(submitted);
    if (!parsed.ok) { setFields(parsed.fields); requestAnimationFrame(() => form.current?.querySelector<HTMLElement>("[aria-invalid=true]")?.focus()); return; }
    void receive(() => source.save(parsed.data), () => closeDialog());
  }
  function pick(suggestion: Suggestion) {
    sequence.current++; setManual(false); setLookup({ status: "idle", suggestions: [] });
    setInput(old => ({ ...old, line1: suggestion.line1, suburb: suggestion.suburb, city: suggestion.city, postcode: suggestion.postcode ?? "", locationSource: "SEARCH", point: suggestion.point }));
  }
  const change = (key: keyof AddressInput, value: string) => setInput(old => ({ ...old, [key]: value }));
  const add = <Button data-address-add onClick={() => open("add")} disabled={offline ? "You’re offline" : addresses.length >= MAX_SAVED_ADDRESSES ? "You can save up to 10 addresses." : pending} width="auto">Add address</Button>;

  if (preview === "loading") return <AddressesLoading headingLevel={headingLevel} />;
  return <div ref={root} className={styles.page}>
    <div className={styles.heading}><Heading className={account.title}>Addresses</Heading>{addresses.length > 0 && !loadError && add}</div>
    <OfflineBanner online={preview === "offline" ? false : undefined} sticky={false} />
    {addresses.length >= MAX_SAVED_ADDRESSES && <p className={account.hint}>You can save up to 10 addresses.</p>}
    {failure && !dialog && <InlineError message={errors[failure.error]} />}
    {loadError ? <ErrorState title="Couldn’t load your addresses." onRetry={() => receive(source.list, () => undefined)} /> : !addresses.length ? <EmptyState icon="home" title="No saved addresses yet." action={add} />
      : <div className={styles.list}>{addresses.map(address => {
        const lines = addressLines(address);
        return <article key={address.id} className={account.card} aria-labelledby={`${id}-${address.id}`} data-address-id={address.id} tabIndex={-1}>
          <div className={styles.cardHeading}><h2 id={`${id}-${address.id}`}>{address.label || "Address"}</h2>{address.isDefault && <Pill kind="good">Default</Pill>}</div>
          <p className={styles.address}>{lines[0]}<br />{lines[1]}</p>
          <div className={styles.actions}>
            <Button data-address-action="edit" variant="secondary" size="sm" width="auto" disabled={pending || offline} onClick={() => open("edit", address)}>Edit</Button>
            {!address.isDefault && <Button variant="tertiary" size="sm" width="auto" disabled={pending || offline} onClick={() => receive(() => source.makeDefault(address.id), () => { requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(`[data-address-id="${address.id}"]`)?.focus()); })}>Make default</Button>}
            <Button data-address-action="delete" variant="destructive" size="sm" width="auto" disabled={pending || offline} onClick={() => open("delete", address)}>Delete</Button>
          </div>
        </article>;
      })}</div>}

    <Dialog open={dialog === "add" || dialog === "edit"} title={dialog === "edit" ? "Edit address" : "Add address"} onClose={() => { if (!pending) closeDialog(); }} dismissible={!pending}
      footer={<><Button variant="secondary" disabled={pending} onClick={() => closeDialog()}>Cancel</Button><Button loading={pending} disabled={offline} onClick={save}>Save</Button></>}>
      <form ref={form} className={styles.form} onSubmit={event => { event.preventDefault(); save(); }} noValidate>
        {offline && <InlineError message="You’re offline. Reconnect before saving." />}
        {failure && <InlineError message={errors[failure.error]} />}
        <TextField label="Label" placeholder="Home" value={input.label} maxLength={40} error={fields.label} readOnly={pending} onChange={event => change("label", event.target.value)} />
        <AddressField label="Address" autoComplete="street-address" value={input.locationSource === "SEARCH" ? [input.line1, input.suburb, input.city].filter(Boolean).join(", ") : input.line1} required maxLength={200} readOnly={pending}
          suggestions={lookup.suggestions} status={lookup.status} error={fields.line1 ?? fields.point ?? fields.locationSource} onQueryChange={value => {
            sequence.current++; setLookup({ status: "idle", suggestions: [] }); setInput(old => ({ ...old, line1: value, suburb: "", city: "", postcode: "", locationSource: "TYPED", point: null }));
          }} onSelect={option => { const found = lookup.suggestions.find(value => value.id === option.id); if (found) pick(found); }} />
        <TextField label="Unit or flat" autoComplete="address-line2" value={input.line2} maxLength={200} error={fields.line2} readOnly={pending} onChange={event => change("line2", event.target.value)} />
        {manual && <>
          <TextField label="Suburb" autoComplete="address-level2" value={input.suburb} maxLength={100} required error={fields.suburb} readOnly={pending} onChange={event => change("suburb", event.target.value)} />
          <TextField label="City" autoComplete="address-level1" value={input.city} maxLength={100} required error={fields.city} readOnly={pending} onChange={event => change("city", event.target.value)} />
          <TextField label="Postcode" autoComplete="postal-code" value={input.postcode} inputMode="numeric" maxLength={4} error={fields.postcode} readOnly={pending} onChange={event => change("postcode", event.target.value)} />
        </>}
      </form>
    </Dialog>
    <Dialog open={dialog === "delete"} role="alertdialog" title="Delete this address?" dismissible={!pending} onClose={() => { if (!pending) closeDialog(); }}
      footer={<><Button variant="secondary" disabled={pending} onClick={() => closeDialog()}>Keep</Button><Button variant="destructive" loading={pending} disabled={offline} onClick={() => dialog === "delete" && selected && receive(() => source.delete(selected.id), () => closeDialog(true))}>Delete</Button></>}>
      {selected && <p className={styles.address}>{addressLines(selected).join(", ")}</p>}
      {failure && <InlineError message={errors[failure.error]} />}
    </Dialog>
  </div>;
}

export { ADDRESS_STATES };
