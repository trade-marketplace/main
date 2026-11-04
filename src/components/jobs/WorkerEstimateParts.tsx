"use client";
import { IconButton } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { ChipGroup, SwitchField } from "@/components/forms/ChoiceFields";
import { MoneyField, TextAreaField, TextField } from "@/components/forms/TextFields";
import { Banner } from "@/components/overlays/Banner";
import { formatCents } from "@/components/status/PriceBlock";
import { QUOTE_POINTS } from "@/lib/points";
import { ESTIMATE_ELIGIBILITY_MESSAGES, type EstimateFields, type OwnEstimate } from "@/lib/worker-estimate";
import type { EligibilityFailure } from "@/server/workers/eligibility";
import styles from "./worker-estimate.module.css";

const money = new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD", maximumFractionDigits: 2 });
const wholeDollars = new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD", maximumFractionDigits: 0 });
const HOUR_PICKS = ["0.5", "1", "2", "4", "6", "8"];
const MATERIAL_PICKS = ["0", "50", "100", "250", "500"];

/** The gold point a tradie earns for every quote (#279, still being worked out). */
export function PointsChip({ points = QUOTE_POINTS, earned = false }: { points?: number; earned?: boolean }) {
  return <span className={styles.points} data-earned={earned || undefined}>
    <Icon name={earned ? "check_circle" : "toll"} size="sm" fill decorative />
    <span>+{points}</span><span className={styles.srOnly}>{points === 1 ? " point" : " points"}{earned ? " earned" : ""}</span>
  </span>;
}

export function WorkerEstimateNotice({ failure }: { failure: EligibilityFailure }) {
  return <Banner tone="alert">{ESTIMATE_ELIGIBILITY_MESSAGES[failure]}</Banner>;
}
export function WorkerEstimateEarnings({ cents, forecast = false }: { cents: number; forecast?: boolean }) {
  return <p className={styles.earn}><span>You’d earn</span><b>{forecast ? wholeDollars.format(cents / 100) : formatCents(cents)}</b></p>;
}

export function WorkerEstimateSummary({ own, canEdit = true }: { own: OwnEstimate; canEdit?: boolean }) {
  const hours = own.minutes / 60;
  return <>
    <div className={styles.quoteValue}>
      <span><b>{hours} h</b> on site</span>
      <span><b>{money.format(own.materialsCents / 100)}</b> materials</span>
      {own.needsSiteVisit && <span>Needs a site visit</span>}
    </div>
    {own.madeBeforeEdit && <Banner tone="info" title="Job updated">{canEdit ? "Check your quote and send it again." : undefined}</Banner>}
  </>;
}

export type EstimateControls = {
  value: EstimateFields; fields: Partial<Record<keyof EstimateFields, string>>; saving?: boolean;
  change: <K extends keyof EstimateFields>(key: K, next: EstimateFields[K]) => void; step: (delta: number) => void;
};

/** Tap-first: big hour stepper with quick picks, materials quick picks, everything else optional. */
export function WorkerEstimateFields({ value, fields, saving, change, step }: EstimateControls) {
  const hours = Number(value.hours), materials = Number(value.materials);
  const arrows = (key: string) => ["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft"].includes(key);
  return <>
    <div className={styles.block}>
      <div className={styles.stepper}>
        <IconButton icon="remove" label="Fewer hours" onClick={() => step(-0.5)} disabled={saving || hours <= 0.5} />
        <TextField label="Hours on site" name="hours" type="number" inputMode="decimal" min="0.5" max="40" step="0.5"
          value={value.hours} onChange={event => change("hours", event.target.value)} disabled={saving} error={fields.hours}
          onKeyDown={event => { if (arrows(event.key)) { event.preventDefault(); step(["ArrowUp", "ArrowRight"].includes(event.key) ? 0.5 : -0.5); } }} />
        <IconButton icon="add" label="More hours" onClick={() => step(0.5)} disabled={saving || hours >= 40} />
      </div>
      <ChipGroup label="Quick hours" hideLabel className={styles.picks} disabled={saving}
        value={HOUR_PICKS.find(pick => Number(pick) === hours) ?? ""} onChange={pick => change("hours", pick)}
        options={HOUR_PICKS.map(pick => ({ value: pick, label: pick === "0.5" ? "½ h" : `${pick} h` }))} />
    </div>
    <div className={styles.block}>
      <MoneyField label="Materials" name="materials" value={value.materials} onChange={event => change("materials", event.target.value)}
        disabled={saving} error={fields.materials} />
      <ChipGroup label="Quick materials" hideLabel className={styles.picks} disabled={saving}
        value={MATERIAL_PICKS.find(pick => Number(pick) === materials && value.materials.trim() !== "") ?? ""}
        onChange={pick => change("materials", `${pick}.00`)}
        options={MATERIAL_PICKS.map(pick => ({ value: pick, label: `$${pick}` }))} />
    </div>
    <TextAreaField label="Notes" name="note" rows={3} value={value.note} onChange={event => change("note", event.target.value)}
      disabled={saving} error={fields.note} />
    <SwitchField label="Needs a site visit" checked={value.needsSiteVisit} onChange={event => change("needsSiteVisit", event.target.checked)} disabled={saving} />
  </>;
}
