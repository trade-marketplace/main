"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { TextLink } from "@/components/TextLink";
import { useOptionalSessionExpired } from "@/components/auth/SessionExpired";
import { LoadingRegion, Skeleton, useOnlineStatus } from "@/components/feedback";
import { PasswordField, SelectField, TextField } from "@/components/forms/TextFields";
import { Banner } from "@/components/overlays/Banner";
import { ToastProvider, useToast } from "@/components/overlays/Toast";
import type { AuthFailure } from "@/lib/auth/results";
import { boardSettingsRoute } from "@/lib/job-board";
import { KIWISAVER_RATES, OFFICE_TAX_CODE, TAX_CODES, TAX_CODE_HELP, maskedBank, maskedIrd, validatePayroll, type PayrollInput, type PayrollResult, type PayrollSummary } from "@/lib/payroll";
import { savePayrollAction } from "@/server/account/payroll-actions";

import account from "./account.module.css";
import styles from "./payroll.module.css";

export type PayrollAction = (input: PayrollInput) => Promise<PayrollResult | AuthFailure>;
export type PayrollPreview = "missing" | "saved" | "editing" | "validation" | "error" | "no-key" | "offline" | "saving" | "review";
const emptyInput = (summary: PayrollSummary): PayrollInput => ({ bankAccount: "", irdNumber: "", taxCode: summary.review.includes("tax-code") ? OFFICE_TAX_CODE : summary.taxCode ?? "", kiwiSaverRate: summary.kiwiSaverRatePct === 3 ? "" : summary.kiwiSaverRatePct === null ? "none" : String(summary.kiwiSaverRatePct), currentPassword: "" });
const ERRORS: Record<Extract<PayrollResult, { ok: false }>["error"], string> = {
  invalid: "Check the highlighted fields.", "wrong-password": "That’s not your current password. Try again.",
  "session-expired": "Log in again to save your bank and tax details.", forbidden: "You can’t change these details with this account.",
  "try-later": "Too many tries. Try again shortly.", unavailable: "Couldn’t save that. Check your connection and try again.",
  "no-key": "Bank details can’t be saved yet. Try again later.",
};

export function PayrollLoading() {
  return <><h1 className={account.title}>Bank &amp; tax</h1><LoadingRegion loading label="Loading bank and tax details" skeleton={<div className={account.card}>{[0, 1, 2].map(item => <div className={styles.skeleton} key={item}><Skeleton width={120} height={20} /><Skeleton height={48} /></div>)}</div>} /></>;
}

export function PayrollLoadError({ next }: { next?: string | null } = {}) {
  return <><h1 className={account.title}>Bank &amp; tax</h1><Banner tone="alert">Couldn’t load your bank and tax details. <TextLink href={boardSettingsRoute("/profile/payroll", next).href}>Try again</TextLink></Banner></>;
}

function TaxReviewNotice() {
  return <Banner tone="info" title="Your tax code needs a payroll review." action={<TextLink href="/contact" inline>Contact us</TextLink>}>Contact us about your IRD certificate or tax code before choosing another code.</Banner>;
}

export function PayrollSettings(props: { initial: PayrollSummary; action?: PayrollAction; preview?: PayrollPreview }) {
  return <ToastProvider><PayrollForm {...props} /></ToastProvider>;
}

function PayrollForm({ initial, action = savePayrollAction, preview }: { initial: PayrollSummary; action?: PayrollAction; preview?: PayrollPreview }) {
  const router = useRouter(); const toast = useToast(); const session = useOptionalSessionExpired();
  const online = useOnlineStatus();
  const [summary, setSummary] = useState(initial);
  const [editing, setEditing] = useState(!initial.saved || ["editing", "validation", "error", "saving"].includes(preview ?? ""));
  const [input, setInput] = useState<PayrollInput>(() => emptyInput(initial));
  const [result, setResult] = useState<PayrollResult | null>(preview === "validation" ? { ok: false, error: "invalid", fields: { bankAccount: "Enter a valid New Zealand bank account number.", irdNumber: "Enter a valid IRD number." } } : preview === "error" ? { ok: false, error: "unavailable" } : null);
  const [pending, start] = useTransition();
  const form = useRef<HTMLFormElement>(null); const message = useRef<HTMLDivElement>(null);
  const offline = !online || preview === "offline";
  const busy = pending || preview === "saving";
  const canSave = summary.canSave && preview !== "no-key";
  const fields = result && !result.ok ? result.fields : undefined;
  useEffect(() => {
    if (!result || result.ok) return;
    form.current?.querySelector<HTMLInputElement>("[aria-invalid=true]")?.focus();
  }, [result]);
  const change = (field: keyof PayrollInput, value: string) => setInput(previous => ({ ...previous, [field]: value }));
  const save = () => {
    if (busy || offline || !canSave) return;
    const parsed = validatePayroll(input);
    if (!parsed.ok) { setResult({ ok: false, error: "invalid", fields: parsed.fields }); return; }
    start(async () => {
      let answer: PayrollResult | AuthFailure;
      try { answer = await action(input); } catch { answer = { ok: false, error: "unavailable" }; }
      if (session?.check(answer)) return;
      if (answer.ok && "summary" in answer) {
        setSummary(answer.summary); setInput(emptyInput(answer.summary)); setResult(answer); setEditing(false);
        toast.show({ message: "Saved." }); router.refresh();
      } else {
        const failure = answer as Extract<PayrollResult, { ok: false }>;
        if (failure.error === "no-key") setSummary(previous => ({ ...previous, canSave: false }));
        setResult(failure); message.current?.focus();
      }
    });
  };
  return <>
    <h1 className={account.title}>Bank &amp; tax</h1>
    {offline && <Banner tone="alert" live>You’re offline. Reconnect before saving.</Banner>}
    {!canSave && <Banner tone="info">{ERRORS["no-key"]}</Banner>}
    {(!summary.bankAccountLast4 || !summary.irdNumberLast3 || !summary.taxCode) && <Banner tone="info" title="Add bank account & IRD number.">So we can pay you through payroll.</Banner>}
    {summary.review.includes("kiwisaver") && <Banner tone="info" title="Your saved 3% rate needs review." action={<TextLink href="/contact" inline>Contact us</TextLink>}>Choose your standard rate when editing, or contact us about an approved temporary reduction before payroll.</Banner>}
    {summary.review.includes("tax-code") && <TaxReviewNotice />}
    {result && !result.ok && <div ref={message} tabIndex={-1}><Banner tone="alert" live>{ERRORS[result.error]}</Banner></div>}
    <section className={account.card} aria-label="Bank and tax details">
      <p className={styles.trust}>Your bank and IRD details are encrypted and only used for payroll.</p>
      {summary.saved && !editing ? <>
        <dl className={`${styles.summary}${result?.ok ? " tm-anim-status" : ""}`}>
          <div><dt>Bank account</dt><dd>{maskedBank(summary.bankAccountLast4)}</dd></div>
          <div><dt>IRD number</dt><dd>{maskedIrd(summary.irdNumberLast3)}</dd></div>
          <div><dt>Tax code</dt><dd>{summary.taxCode ?? "Not added"}</dd></div>
          <div><dt>KiwiSaver</dt><dd>{summary.kiwiSaverRatePct === null ? "Not enrolled" : `${summary.kiwiSaverRatePct}%`}</dd></div>
        </dl>
        <Button width="auto" disabled={!canSave || offline} onClick={() => { setEditing(true); setResult(null); }}>Edit (asks for your password)</Button>
      </> : <form className={styles.form} ref={form} noValidate onSubmit={event => { event.preventDefault(); save(); }}>
        <fieldset disabled={busy || offline || !canSave} className={styles.fields}>
          <legend className={styles.legend}>{summary.saved ? "Edit bank & tax" : "Add bank & tax"}</legend>
          <PasswordField variant="box" label="Current password" name="currentPassword" value={input.currentPassword} maxLength={200} onChange={event => change("currentPassword", event.target.value)} error={fields?.currentPassword} required hint="Enter your password again to save these details." />
          <TextField label="Bank account" name="bankAccount" autoComplete="off" inputMode="numeric" placeholder="01-0902-0068389-00" maxLength={40} value={input.bankAccount} onChange={event => change("bankAccount", event.target.value)} error={fields?.bankAccount} required hint="Bank · branch · account · suffix" />
          <TextField label="IRD number" name="irdNumber" autoComplete="off" inputMode="numeric" placeholder="49-091-850" maxLength={20} value={input.irdNumber} onChange={event => change("irdNumber", event.target.value)} error={fields?.irdNumber} required />
          <SelectField label="Tax code" name="taxCode" value={input.taxCode} onChange={event => change("taxCode", event.target.value)} error={fields?.taxCode} required>
            <option value="">Choose your tax code</option>{TAX_CODES.map(code => <option key={code} value={code}>{code}</option>)}<option value={OFFICE_TAX_CODE}>Another tax code / IRD certificate</option>
          </SelectField>
          <p className={styles.help}>Use the code on your tax code declaration. <TextLink href={TAX_CODE_HELP} target="_blank" rel="noreferrer">Work out your tax code <span className={styles.srOnly}>(opens in a new tab)</span></TextLink></p>
          <p className={styles.help}>For STC, NSW or a code that isn’t listed, <TextLink href="/contact" inline>contact us</TextLink>.</p>
          {input.taxCode === OFFICE_TAX_CODE && !summary.review.includes("tax-code") && <TaxReviewNotice />}
          <SelectField label="KiwiSaver" name="kiwiSaverRate" value={input.kiwiSaverRate} onChange={event => change("kiwiSaverRate", event.target.value)} error={fields?.kiwiSaverRate}>
            <option value="">Choose your KiwiSaver rate</option><option value="none">Not enrolled</option>{KIWISAVER_RATES.map(rate => <option key={rate} value={rate}>{rate}%</option>)}
          </SelectField>
          <p className={styles.help}>The current default rate is 3.5%. It increases to 4% from 1 April 2028.</p>
          <p className={styles.help}>For an approved temporary 3% reduction, <TextLink href="/contact" inline>contact us</TextLink> before payroll.</p>
        </fieldset>
        <div className={styles.actions}>
          <Button type="submit" loading={busy} disabled={offline || !canSave || input.taxCode === OFFICE_TAX_CODE}>Save details</Button>
          {summary.saved && <Button variant="secondary" width="auto" disabled={busy} onClick={() => { setInput(emptyInput(summary)); setResult(null); setEditing(false); }}>Cancel</Button>}
        </div>
      </form>}
    </section>
  </>;
}
