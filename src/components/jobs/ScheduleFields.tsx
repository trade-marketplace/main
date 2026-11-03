"use client";
import { useId } from "react";
import { CheckboxField } from "@/components/forms/ChoiceFields";
import { TimeWindowPicker } from "@/components/forms/TimeWindowPicker";
import type { JobDraft } from "@/lib/job-draft";
import { DAY_PARTS, postingDays, selectedTimeWindows, timeWindowKey } from "@/lib/job-time-windows";
import styles from "./post-job.module.css";

export type Schedule = Pick<JobDraft, "timeWindows" | "anyTime" | "asap">;
export function ScheduleFields({ value, onChange, now, error, disabled }: { value: Schedule; onChange(value: Schedule): void; now: Date; error?: string; disabled?: boolean }) {
  const id = useId();
  const days = postingDays(now); const enabled = days.flatMap(day => day.windows.map(window => window.value));
  const selected = value.anyTime ? enabled : (value.timeWindows ?? []).map(timeWindowKey).filter(key => enabled.includes(key));
  const expired = value.anyTime ? [] : (value.timeWindows ?? []).filter(window => !enabled.includes(timeWindowKey(window)));
  const dateLabel = new Intl.DateTimeFormat("en-NZ", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
  return <div className={styles.schedule}>
    <TimeWindowPicker id={`${id}-windows`} name="time-windows" label="When are you free?" hint="Pick all the times someone can come." hintVisible required disabled={disabled}
      days={days} value={selected} error={error ?? (expired.length ? "When do you need it?" : undefined)} onChange={keys => onChange({ ...value, timeWindows: selectedTimeWindows(keys, now), anyTime: enabled.every(key => keys.includes(key)) })} />
    {expired.length > 0 && <ul className={styles.expiredWindows}>{expired.map(window => <li key={timeWindowKey(window)}>{dateLabel.format(new Date(`${window.date}T00:00:00Z`))} · {DAY_PARTS.find(part => part.value === window.timeOfDay)?.label}</li>)}</ul>}
    <CheckboxField label="ASAP: today if possible" name="asap" checked={value.asap ?? false} disabled={disabled} onChange={event => onChange({ ...value, asap: event.target.checked })} />
  </div>;
}
