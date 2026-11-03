"use client";
import { CheckboxField } from "@/components/forms/ChoiceFields";
import { TimeWindowPicker } from "@/components/forms/TimeWindowPicker";
import type { JobDraft } from "@/lib/job-draft";
import { postingDays, selectedTimeWindows, timeWindowKey } from "@/lib/job-time-windows";
import styles from "./post-job.module.css";

export type Schedule = Pick<JobDraft, "timeWindows" | "anyTime" | "asap">;
export function ScheduleFields({ value, onChange, now, error, disabled }: { value: Schedule; onChange(value: Schedule): void; now: Date; error?: string; disabled?: boolean }) {
  const days = postingDays(now); const enabled = days.flatMap(day => day.windows.map(window => window.value));
  const selected = value.anyTime ? enabled : (value.timeWindows ?? []).map(timeWindowKey).filter(key => enabled.includes(key));
  return <div className={styles.schedule}>
    <TimeWindowPicker id="time-windows" name="time-windows" label="When are you free?" hint="Pick all the times someone can come." required disabled={disabled}
      days={days} value={selected} error={error} onChange={keys => onChange({ ...value, timeWindows: selectedTimeWindows(keys, now), anyTime: enabled.every(key => keys.includes(key)) })} />
    <CheckboxField label="ASAP: today if possible" name="asap" checked={value.asap ?? false} disabled={disabled} onChange={event => onChange({ ...value, asap: event.target.checked })} />
  </div>;
}
