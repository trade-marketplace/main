"use client";
import { IconButton } from "@/components/Button";
import { CheckboxField } from "@/components/forms/ChoiceFields";
import { MoneyField, TextAreaField, TextField } from "@/components/forms/TextFields";
import { Banner } from "@/components/overlays/Banner";
import { ESTIMATE_ELIGIBILITY_MESSAGES, type EstimateFields, type OwnEstimate } from "@/lib/worker-estimate";
import type { EligibilityFailure } from "@/server/workers/eligibility";
import styles from "./worker-estimate.module.css";

export function WorkerEstimateNotice({ failure }: { failure: EligibilityFailure }) { return <Banner tone="alert">{ESTIMATE_ELIGIBILITY_MESSAGES[failure]}</Banner>; }
export function WorkerEstimateSummary({ own }: { own: OwnEstimate }) {
  return <><p className={styles.estimate}>Your estimate: <b>{own.minutes / 60} h · {new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD", maximumFractionDigits: 2 }).format(own.materialsCents / 100)}</b></p>{own.madeBeforeEdit && <Banner tone="info" title="Job updated" />}</>;
}
export type EstimateControls = { value: EstimateFields; fields: Partial<Record<keyof EstimateFields, string>>; saving?: boolean;
  change: <K extends keyof EstimateFields>(key: K, next: EstimateFields[K]) => void; step: (delta: number) => void };
export function WorkerEstimateFields({ value, fields, saving, change, step }: EstimateControls) {
  return <>
    <div><div className={styles.stepper}><IconButton icon="remove" label="Reduce hours" onClick={() => step(-0.5)} disabled={saving || Number(value.hours) <= 0.5} /><TextField label="Hours on site" name="hours" type="number" inputMode="decimal" min="0.5" max="40" step="0.5" value={value.hours} onChange={event => change("hours", event.target.value)} onKeyDown={event => { if (["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft"].includes(event.key)) { event.preventDefault(); step(["ArrowUp", "ArrowRight"].includes(event.key) ? 0.5 : -0.5); } }} disabled={saving} error={fields.hours} hint="Half-hour steps. On site only, not travel." /><IconButton icon="add" label="Increase hours" onClick={() => step(0.5)} disabled={saving || Number(value.hours) >= 40} /></div><p className={styles.hint} aria-hidden="true">Half-hour steps. On site only, not travel.</p></div>
    <div><MoneyField label="Materials (your cost, excl. GST)" name="materials" value={value.materials} onChange={event => change("materials", event.target.value)} disabled={saving} error={fields.materials} hint="Rough is fine." /><p className={styles.hint} aria-hidden="true">Rough is fine.</p></div>
    <TextAreaField label="Notes for the office (optional)" name="note" value={value.note} onChange={event => change("note", event.target.value)} disabled={saving} error={fields.note} maxLength={2000} />
    <CheckboxField label="Can’t price this from photos. It needs a site visit." checked={value.needsSiteVisit} onChange={event => change("needsSiteVisit", event.target.checked)} disabled={saving} />
  </>;
}
