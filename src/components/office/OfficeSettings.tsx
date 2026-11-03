"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { Tabs } from "@/components/data/Tabs";
import { TextField } from "@/components/forms/TextFields";
import { SwitchField } from "@/components/forms/ChoiceFields";
import { OfflineBanner, useOnlineStatus } from "@/components/feedback/OfflineBanner";
import { Banner } from "@/components/overlays/Banner";
import { ConfirmDialog } from "@/components/overlays/Dialog";
import { useToast } from "@/components/overlays/Toast";
import { COVERAGE_FIELDS, RATE_FIELDS, SETTINGS_TABS, TRADES, TRADE_NAMES, displayNumber, parseSettingsInput, settingsChanges, type CoverageCount, type PriceExamples, type SettingsChange, type SettingsInput, type SettingsPageData, type SettingsRecord, type SettingsTab } from "@/lib/office-settings";
import { manageOfficeTeamAction, previewCoverageAction, previewOfficeSettingsAction, saveOfficeSettingsAction } from "@/server/office/settings-actions";
import { CoverageMap } from "./CoverageMap";
import styles from "./settings.module.css";

export type SettingsServices = {
  save(input: SettingsInput): Promise<{ ok: boolean; record?: SettingsRecord; error?: string; fields?: Record<string, string> }>;
  preview(input: SettingsInput): Promise<{ ok: boolean; examples?: PriceExamples }>;
  coverage(input: SettingsInput): Promise<{ ok: boolean; count?: CoverageCount | null }>;
  team(input: { operation: "preview-add" | "add" | "remove"; email: string }): Promise<{ ok: boolean; error?: string; team?: SettingsPageData["team"]; before?: string; email?: string; leaveOffice?: boolean }>;
};
const LIVE_SERVICES: SettingsServices = { save: saveOfficeSettingsAction, preview: previewOfficeSettingsAction, coverage: previewCoverageAction, team: manageOfficeTeamAction };
const tabItems = SETTINGS_TABS.map(value => ({ value, label: value[0].toUpperCase() + value.slice(1) }));
const fieldsOf = (tab: SettingsTab) => tab === "rates" ? RATE_FIELDS : COVERAGE_FIELDS;
const initialForm = (record: SettingsRecord) => Object.fromEntries([...RATE_FIELDS, ...COVERAGE_FIELDS].map(field => [field.key, displayNumber(field, record.values[field.key])]));
const money = (cents: number) => new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" }).format(cents / 100);
export type OfficeSettingsProps = { data: SettingsPageData | null; mapToken?: string | null; initialTab?: SettingsTab; state?: string; services?: SettingsServices };

export function OfficeSettings({ data, mapToken = null, initialTab = "rates", state, services = LIVE_SERVICES }: OfficeSettingsProps) {
  if (!data || state === "loading") return <section className={styles.page}><h1>Settings</h1>{state === "loading" ? <div className={styles.card} role="status" aria-label="Loading settings"><div className={styles.skeleton} /><div className={styles.skeleton} /><div className={styles.skeleton} /></div> : <Banner tone="alert" title="Can’t load settings">Try again in a moment.<Button variant="secondary" onClick={() => window.location.reload()}>Try again</Button></Banner>}</section>;
  return <SettingsEditor {...{ data, mapToken, initialTab, state, services }} />;
}

function SettingsEditor({ data, mapToken, initialTab, state, services }: OfficeSettingsProps & { data: SettingsPageData; services: SettingsServices }) {
  const router = useRouter(), toast = useToast();
  const online = useOnlineStatus() && state !== "offline";
  const [tab, setTab] = useState<SettingsTab>(initialTab ?? "rates");
  const [record, setRecord] = useState(data.record);
  const [form, setForm] = useState<Record<string, string>>(() => ({ ...initialForm(data.record), ...(state === "saving" || state === "save-error" ? { sharedRateCents: "72" } : state === "validation" ? { sharedRateCents: "-1" } : {}) }));
  const [enabled, setEnabled] = useState(data.record.enabledTrades);
  const [team, setTeam] = useState(data.team);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(state === "save-error" ? "Couldn’t save that. Nothing was changed. Try again." : null);
  const [errors, setErrors] = useState<Record<string, string>>(state === "validation" ? { sharedRateCents: "Enter tradie hourly rate from 1 to 1000." } : {});
  const [busy, setBusy] = useState(state === "saving");
  const [examples, setExamples] = useState<PriceExamples | null>(data.examples);
  const [coverage, setCoverage] = useState<CoverageCount | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const [confirm, setConfirm] = useState<{ changes: SettingsChange[]; input?: SettingsInput; team?: { operation: "add" | "remove"; email: string } } | null>(null);
  const settingsTab = tab === "rates" || tab === "coverage" || tab === "trades" ? tab : "rates";
  const input: SettingsInput = { tab: settingsTab, version: record.version, values: tab === "trades" ? {} : Object.fromEntries(fieldsOf(tab).map(field => [field.key, form[field.key]])), ...(tab === "trades" ? { enabledTrades: enabled } : {}) };
  const inputKey = JSON.stringify(input);
  const rawDirty = tab === "trades" ? TRADES.some(trade => enabled.includes(trade) !== record.enabledTrades.includes(trade)) : fieldsOf(tab).some(field => form[field.key] !== displayNumber(field, record.values[field.key]));
  const dirty = parseSettingsInput(input).ok ? settingsChanges(record, input).length > 0 : rawDirty;
  const parsedCoverage = useMemo(() => parseSettingsInput({ tab: "coverage", version: record.version, values: Object.fromEntries(COVERAGE_FIELDS.map(field => [field.key, form[field.key]])) }), [record.version, form]);
  const area = useMemo(() => ({ name: "Coverage", centre: { lat: parsedCoverage.ok ? parsedCoverage.values.coverageCentreLat! : record.values.coverageCentreLat, lng: parsedCoverage.ok ? parsedCoverage.values.coverageCentreLng! : record.values.coverageCentreLng }, radiusKm: parsedCoverage.ok ? parsedCoverage.values.coverageRadiusKm! : record.values.coverageRadiusKm }), [parsedCoverage, record]);

  useEffect(() => {
    if (!online || (tab !== "rates" && tab !== "coverage")) return;
    const request = JSON.parse(inputKey) as SettingsInput;
    if (!parseSettingsInput(request).ok) return;
    let active = true;
    const timer = window.setTimeout(() => {
      if (tab === "rates") void services.preview(request).then(result => { if (active) { setExamples(result.ok ? result.examples ?? null : null); setPreviewError(!result.ok); } }).catch(() => { if (active) setPreviewError(true); });
      else void services.coverage(request).then(result => { if (active) { setCoverage(result.ok ? result.count ?? null : null); setPreviewError(!result.ok); } }).catch(() => { if (active) setPreviewError(true); });
    }, 400);
    return () => { active = false; window.clearTimeout(timer); };
  }, [inputKey, services, tab, online]);

  function changeField(key: string, value: string) {
    setForm(old => ({ ...old, [key]: value })); setErrors({}); setError(null); setPreviewError(false);
    if (tab === "rates") setExamples(null); else setCoverage(null);
  }
  function requestSave(event: React.FormEvent) {
    event.preventDefault(); if (!online) return; setError(null);
    const parsed = parseSettingsInput(input);
    if (!parsed.ok) { setErrors(parsed.fields); document.getElementById(`office-setting-${Object.keys(parsed.fields)[0]}`)?.focus(); return; }
    setConfirm({ changes: settingsChanges(record, input), input });
  }
  async function confirmSave() {
    if (!confirm || !online) return;
    setBusy(true); setError(null);
    try {
      if (confirm.team) {
        const result = await services.team(confirm.team);
        if (!result.ok) { setError(result.error ?? "Couldn’t save that. Nothing was changed. Try again."); return; }
        if (result.leaveOffice) { router.replace("/"); return; }
        if (result.team) setTeam(result.team);
        setEmail("");
      } else if (confirm.input) {
        const result = await services.save(confirm.input);
        if (!result.ok || !result.record) { setErrors(result.fields ?? {}); setError(result.error === "changed" ? "Settings changed while you were editing. Reload before saving." : "Couldn’t save that. Nothing was changed. Try again."); return; }
        setRecord(result.record);
      }
      setConfirm(null); toast.show({ message: "Saved" });
    } catch { setError("Couldn’t save that. Nothing was changed. Try again."); }
    finally { setBusy(false); }
  }
  async function addTeam(event: React.FormEvent) {
    event.preventDefault(); if (!online) return; setError(null); setBusy(true);
    try {
      const result = await services.team({ operation: "preview-add", email });
      if (!result.ok) { setError(result.error ?? "Check the email address."); return; }
      if (result.before === "ADMIN") { setError("This person is already an office user."); return; }
      setConfirm({ changes: [{ field: result.email ?? email, before: result.before ?? "CUSTOMER", after: "ADMIN" }], team: { operation: "add", email: result.email ?? email } });
    } catch { setError("Couldn’t save that. Nothing was changed. Try again."); }
    finally { setBusy(false); }
  }
  const numberFields = (group: string) => fieldsOf(tab).filter(field => field.group === group).map(field => <TextField key={field.key} id={`office-setting-${field.key}`} label={field.label} inputMode="decimal" value={form[field.key]} prefix={field.unit === "money" ? "$" : undefined} suffix={field.unit === "percent" ? "%" : undefined} error={errors[field.key]} disabled={busy} onChange={event => changeField(field.key, event.target.value)} />);

  return <section className={styles.page}><OfflineBanner online={state === "offline" ? false : undefined} sticky={false} /><h1>Settings</h1><p className={styles.intro}>Changes apply to new prices only. Prices already sent don’t change.</p>
    <Tabs label="Settings" items={tabItems} value={tab} onChange={value => { setTab(value); setError(null); setErrors({}); const url = new URL(window.location.href); url.searchParams.set("tab", value); window.history.replaceState(null, "", url); }}>
      {error && !confirm && <Banner tone="alert" live>{error}{error.startsWith("Settings changed") && <Button variant="secondary" onClick={() => window.location.reload()}>Reload settings</Button>}</Banner>}
      {tab === "emails" ? <div className={styles.card}><h2>Emails</h2><p>Coming soon</p></div> : tab === "team" ? <><div className={styles.card}><h2>Office users</h2><ul className={styles.team}>{team.map(person => <li key={person.email}><div><strong>{person.email}</strong><p className={styles.hint}>{person.since ? `Since ${new Intl.DateTimeFormat("en-NZ", { dateStyle: "medium", timeZone: "Pacific/Auckland" }).format(new Date(person.since))}` : "Office user"}</p></div><Button variant="secondary" disabled={busy || !online || team.length <= 1} onClick={() => setConfirm({ changes: [{ field: person.email, before: "ADMIN", after: "CUSTOMER" }], team: { operation: "remove", email: person.email } })}>Remove</Button></li>)}</ul></div><form className={styles.card} onSubmit={addTeam}><h2>Add an office user</h2><p className={styles.hint}>They must sign up first.</p><TextField label="Email address" type="email" value={email} required disabled={busy} onChange={event => setEmail(event.target.value)} /><div className={styles.actions}><Button type="submit" loading={busy} disabled={!online || !email.trim()}>Add office user</Button></div></form></> : <form noValidate onSubmit={requestSave}>
        {errors.form && <Banner tone="alert" live>{errors.form}</Banner>}
        {tab === "rates" && <><div className={styles.rateCards}>{["Licensed trades", "Other / general labour"].map((group, i) => <fieldset className={styles.card} key={group}><legend>{group}</legend><div className={styles.fields}>{numberFields(group)}</div><p className={styles.example} aria-live="polite">{i === 0 ? "4 h licensed job" : "1 h Other job"} = <strong>{examples ? money(i === 0 ? examples.licensed : examples.other) : "Updating example…"}</strong> incl. GST</p></fieldset>)}</div>{["Shared", "Timing and quote bounties"].map(group => <fieldset key={group} className={styles.card}><legend>{group}</legend><div className={styles.fields}>{numberFields(group)}</div>{group === "Timing and quote bounties" && <p className={styles.hint}>The quoter share base and weekly bonus policy still need a founder decision. These settings do not calculate payouts.</p>}</fieldset>)}</>}
        {tab === "trades" && <div className={styles.card}><h2>Trades</h2><p className={styles.hint}>Switch off a trade to pause new jobs and claims. Work already assigned can finish.</p><ul className={styles.trades}>{TRADES.map(trade => { const rule = data.evidence.find(item => item.trade === trade); return <li key={trade}><SwitchField label={TRADE_NAMES[trade]} checked={enabled.includes(trade)} disabled={busy} onChange={event => setEnabled(old => event.target.checked ? [...old, trade] : old.filter(value => value !== trade))} /><p className={styles.hint}>{trade === "OTHER" ? "No licence needed" : "Licence checked before claiming"}{rule ? ` · ${rule.cocRequired ? "CoC number · " : ""}${rule.cocFileRequired ? "CoC file · " : ""}${rule.minPhotos} photos${rule.notesRequired ? " · Notes" : ""}` : " · Evidence rule not configured"}</p></li>; })}</ul></div>}
        {tab === "coverage" && <div className={styles.card}><h2>Coverage</h2><div className={styles.fields}>{numberFields("Coverage")}</div><CoverageMap area={area} token={mapToken ?? null} /><p className={styles.example} aria-live="polite">{coverage ? `${coverage.inside} waitlist entries inside this area · ${coverage.unlocated} not located · ${coverage.total} total` : "Checking waitlist…"}</p><p className={styles.hint}>Based on suburb centres. Up to 20 suburbs are checked per preview; entries without a known location are listed separately.</p></div>}
        {previewError && <Banner tone="alert" live>Preview unavailable. Try again in a moment.</Banner>}
        <div className={styles.actions}><Button type="button" variant="secondary" disabled={busy || !dirty} onClick={() => { const base = initialForm(record); setForm(old => ({ ...old, ...Object.fromEntries(fieldsOf(tab).map(field => [field.key, base[field.key]])) })); if (tab === "trades") setEnabled(record.enabledTrades); setErrors({}); setError(null); }}>Discard</Button><Button type="submit" loading={busy} disabled={!online || !dirty}>{busy ? "Saving…" : "Save settings"}</Button></div>
      </form>}
    </Tabs>
    <ConfirmDialog open={Boolean(confirm)} title="Save changes?" confirmLabel="Save settings" cancelLabel="Keep editing" onConfirm={confirmSave} onCancel={() => { if (!busy) { setConfirm(null); setError(null); } }} error={error ? <>{error}{error.startsWith("Settings changed") && <Button variant="secondary" onClick={() => window.location.reload()}>Reload settings</Button>}</> : undefined}><ul className={styles.changes}>{confirm?.changes.map(change => <li key={change.field}><strong>{change.field}</strong><span>{change.before} → {change.after}</span></li>)}</ul></ConfirmDialog>
  </section>;
}
