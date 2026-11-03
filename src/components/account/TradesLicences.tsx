"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { ErrorState, InlineError, LiveMessage, LoadingRegion, OfflineBanner, Skeleton, useOnlineStatus } from "@/components/feedback";
import { Field } from "@/components/forms/Field";
import { SelectField, TextField } from "@/components/forms/TextFields";
import { ToastProvider, useToast } from "@/components/overlays/Toast";
import { useSwap } from "@/lib/motion/hooks";
import type { PillKind } from "@/lib/job-status";
import { Pill } from "@/components/status/Pill";
import { DOCUMENT_ACCEPT, licenceState, parseTradeInput, readTradeForm, tradeLabel, type TradeErrors, type TradeSave, type TradeSnapshot } from "@/lib/account/trades";
import { saveTrades } from "@/lib/account/trades-upload";
import { SIGNUP_TRADES, type SignupTrade } from "@/lib/auth/worker-signup";
import account from "./account.module.css";
import styles from "./trades.module.css";

export type TradesPreview = "offline" | "save-error" | "add";


export function TradesLoading() {
  return <><h1 className={account.title}>Trades &amp; licences</h1><LoadingRegion loading label="Loading trades and licences" skeleton={<div className={styles.rows}>
    {[0, 1, 2].map(n => <div className={account.card} key={n}><Skeleton width="45%" height={22} /><div className={styles.skeleton}><Skeleton width="70%" height={16} /></div></div>)}
  </div>} /></>;
}

export function TradesLicences(props: { initial: TradeSnapshot | null; save?: TradeSave; preview?: TradesPreview }) {
  return <ToastProvider><TradesContent key={props.initial ? "loaded" : "unavailable"} {...props} /></ToastProvider>;
}

function TradesContent({ initial, save = saveTrades, preview }: { initial: TradeSnapshot | null; save?: TradeSave; preview?: TradesPreview }) {
  const router = useRouter(); const toast = useToast();
  const [snapshot, setSnapshot] = useState(initial);
  const [editing, setEditing] = useState<SignupTrade | "new" | null>(preview === "save-error" ? "PLUMBING" : preview === "add" ? "new" : null);
  const [trade, setTrade] = useState<SignupTrade | "">(preview === "save-error" ? "PLUMBING" : "");
  const [number, setNumber] = useState(preview === "save-error" ? "PGDB 98211" : "");
  const [expiry, setExpiry] = useState(preview === "save-error" ? "2027-03-31" : "");
  const [errors, setErrors] = useState<TradeErrors>({});
  const [failure, setFailure] = useState<string | null>(preview === "save-error" ? "Couldn’t save." : null);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null); const lastButton = useRef<HTMLButtonElement | null>(null);
  const online = useOnlineStatus() && preview !== "offline";
  useEffect(() => { if (editing) formRef.current?.querySelector<HTMLElement>("select:not(:disabled), input:not([type=hidden])")?.focus(); }, [editing]);
  const close = () => {
    setEditing(null); setFailure(null); setErrors({});
    requestAnimationFrame(() => lastButton.current?.isConnected ? lastButton.current.focus() : document.querySelector<HTMLButtonElement>("[data-add-trade]")?.focus());
  };
  const open = (next: SignupTrade | "new", button: HTMLButtonElement) => {
    lastButton.current = button;
    const row = snapshot?.rows.find(item => item.trade === next);
    setTrade(next === "new" ? "" : next); setNumber(row?.licence?.number ?? ""); setExpiry(row?.licence?.expiresOn ?? "");
    setErrors({}); setFailure(null); setEditing(next);
  };
  if (!snapshot) return <><h1 className={account.title}>Trades &amp; licences</h1><ErrorState title="Couldn’t load licences." onRetry={() => router.refresh()} /></>;
  const warnings = snapshot.rows.filter(row => ["expired", "expiring"].includes(licenceState(row, snapshot.today)));
  const options = SIGNUP_TRADES.filter(option => editing !== "new" || !snapshot.rows.some(row => row.trade === option.value));
  const available = SIGNUP_TRADES.some(option => !snapshot.rows.some(row => row.trade === option.value));
  return <>
    <div><h1 className={account.title}>Trades &amp; licences</h1><p className={account.hint}>Restricted work needs a licence checked by the office.</p></div>
    <OfflineBanner online={preview === "offline" ? false : undefined} sticky={false} />
    {warnings.map(row => <div className={styles.warning} role="status" key={row.trade}><Icon name="warning" size="sm" decorative /><p>{licenceState(row, snapshot.today) === "expired"
      ? `${tradeLabel(row.trade)}: your licence has expired. Update it before claiming jobs in this trade.`
      : `${tradeLabel(row.trade)}: your licence expires within 30 days. Update it to keep taking jobs.`}</p></div>)}
    <div className={styles.rows}>
      {snapshot.rows.map(row => {
        const state = licenceState(row, snapshot.today); const licence = row.licence;
        const label = state === "none" ? "No licence needed" : state === "checked" || state === "expiring" ? "Checked" : state === "checking" ? "Checking" : state === "expired" ? "Expired" : "Rejected";
        return <section className={`${account.card} ${styles.row}`} key={row.trade} aria-label={tradeLabel(row.trade)}>
          <span className={styles.tradeIcon}><Icon name={row.trade === "ELECTRICAL" ? "bolt" : row.trade === "PLUMBING" ? "plumbing" : row.trade === "GAS" ? "local_fire_department" : "handyman"} decorative /></span>
          <div className={styles.details}><h2>{tradeLabel(row.trade)}</h2>{licence && <p className={account.hint}>{licence.number}{licence.expiresOn ? ` · expires ${new Date(`${licence.expiresOn}T00:00:00Z`).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}` : ""}</p>}
            {state === "rejected" && <p className={styles.reason}>{licence?.rejectionReason}</p>}
          </div>
          <LicencePill kind={state === "none" || state === "checked" ? "good" : state === "rejected" || state === "expired" ? "alert" : "waiting"} label={label} />
          {state !== "none" && <div className={styles.rowActions}>
            {licence?.hasDocument && <a className={styles.documentLink} href={`/api/profile/trades/document?trade=${row.trade}`} target="_blank" rel="noopener noreferrer" aria-label={`View ${tradeLabel(row.trade)} licence`}>View</a>}
            <Button variant="tertiary" size="sm" aria-label={`${state === "rejected" ? "Try again" : "Update"} ${tradeLabel(row.trade)} licence`} onClick={event => open(row.trade, event.currentTarget)}>{state === "rejected" ? "Try again" : "Update"}</Button>
          </div>}
        </section>;
      })}
    </div>
    {!editing ? <div><Button data-add-trade icon="add" disabled={available ? undefined : "All trades added."} onClick={event => open("new", event.currentTarget)}>Add a trade</Button></div> :
      <section className={account.card} aria-label={editing === "new" ? "Add a trade" : "Update licence"}>
        <h2>{editing === "new" ? "Add a trade" : snapshot.rows.find(row => row.trade === editing)?.licence?.status === "REJECTED" ? "Try again" : "Update licence"}</h2>
        <form className={account.form} ref={formRef} aria-label="Licence details" noValidate aria-busy={busy} onSubmit={async event => {
          event.preventDefault(); if (busy || !online) return;
          const form = new FormData(event.currentTarget); form.set("trade", trade);
          const parsed = parseTradeInput(readTradeForm(form), snapshot.today);
          const file = form.get("document");
          const fields: TradeErrors = parsed.ok ? {} : parsed.fields;
          if (trade && trade !== "OTHER" && (!(file instanceof File) || !file.size)) fields.document = "Add a photo or PDF of your licence.";
          if (Object.keys(fields).length) { setErrors(fields); requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>("[aria-invalid=true]")?.focus()); return; }
          setBusy(true); setErrors({}); setFailure(null);
          try {
            const result = await save(form);
            if (result.ok) { setSnapshot(result.snapshot); close(); toast.show({ message: "Saved." }); }
            else if (result.error === "invalid") { setErrors(result.fields); requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>("[aria-invalid=true]")?.focus()); }
            else setFailure(result.error === "forbidden" || result.error === "session-expired" ? "Log in to save." : result.message ?? "Couldn’t save.");
          } catch { setFailure("Couldn’t save."); }
          finally { setBusy(false); }
        }}>
          {failure && <InlineError message={failure} />}
          <SelectField label="Trade" name="trade" required disabled={editing !== "new" || busy} value={trade} error={errors.trade} onChange={event => { setTrade(event.target.value as SignupTrade); setErrors({}); }}>
            <option value="">Pick a trade</option>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </SelectField>
          {trade === "OTHER" ? <p className={account.hint}>No licence needed</p> : trade && <>
            <TextField label={SIGNUP_TRADES.find(item => item.value === trade)?.licence?.label ?? "Licence number"} name="number" required maxLength={64} value={number} disabled={busy} error={errors.number} onChange={event => setNumber(event.target.value)} />
            <TextField label="Expiry date" type="date" name="expiresOn" min={snapshot.today} required value={expiry} disabled={busy} error={errors.expiresOn} onChange={event => setExpiry(event.target.value)} />
            <Field label="Licence document" id="licence-document" error={errors.document} hint="PDF, JPG, PNG or HEIC, up to 10 MB." required>
              <input id="licence-document" name="document" className={styles.fileInput} type="file" accept={DOCUMENT_ACCEPT} disabled={busy} required aria-invalid={errors.document ? true : undefined} aria-describedby={errors.document ? "licence-document-error" : "licence-document-hint"} />
            </Field>
          </>}
          <div className={styles.actions}><Button type="submit" loading={busy} disabled={!online ? "Reconnect before saving." : undefined}>Save changes</Button><Button variant="tertiary" disabled={busy} onClick={close}>Cancel</Button></div>
          <LiveMessage message={busy ? "Saving…" : null} />
        </form>
      </section>}
  </>;
}

/** M25 uses the shared status swap timing and reduced-motion behaviour. */
function LicencePill({ kind, label }: { kind: PillKind; label: string }) {
  const { current, previous, swapKey } = useSwap(`${kind}\u0000${label}`);
  const pill = (value: string, hidden = false) => { const [tone, text] = value.split("\u0000"); return <Pill kind={tone as PillKind} aria-hidden={hidden}>{text}</Pill>; };
  return <span className={`tm-swap ${styles.status}`}>
    {previous && <span className="tm-anim-status-out">{pill(previous, true)}</span>}
    <span key={swapKey} className={swapKey > 0 ? "tm-anim-status" : undefined}>{pill(current)}</span>
  </span>;
}
