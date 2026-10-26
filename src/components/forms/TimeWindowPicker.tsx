"use client";

import { useState } from "react";

import { Button } from "@/components/Button";

import { FieldMessages, type FieldMessageProps, useField } from "./Field";
import styles from "./forms.module.css";

export type TimeWindowOption = { value: string; label: string; disabled?: boolean };
export type TimeWindowDay = { value: string; label: string; windows: readonly TimeWindowOption[] };
export type TimeWindowPickerProps = FieldMessageProps & {
  days: readonly TimeWindowDay[];
  name: string;
  value?: readonly string[];
  defaultValue?: readonly string[];
  onChange?: (values: string[]) => void;
  disabled?: boolean;
  emptyMessage?: string;
  id?: string;
};

/** The caller supplies dates, availability and unique window values. No scheduling rules live in the UI. */
export function TimeWindowPicker({ label, hint, error, success, required, days, name, value, defaultValue = [],
  onChange, disabled, emptyMessage = "No time windows are available yet.", id }: TimeWindowPickerProps) {
  const field = useField({ id, hint, error, success });
  const [ownValue, setOwnValue] = useState<readonly string[]>(defaultValue);
  const current = value ?? ownValue;
  const enabled = days.flatMap((day) => day.windows).filter((window) => !window.disabled).map((window) => window.value);
  const allSelected = enabled.length > 0 && enabled.every((item) => current.includes(item));
  function change(next: string[]) { setOwnValue(next); onChange?.(next); }
  return <fieldset id={field.id} className={styles.group} disabled={disabled} aria-describedby={field.describedBy} aria-invalid={error ? true : undefined}>
    <legend className={styles.legend}>{label}{required && <span className={styles.required}> (required)</span>}</legend>
    <FieldMessages id={field.id} {...{ hint, error, success }} />
    {enabled.length > 0 && <div className={styles.windowActions}>
      <Button variant="secondary" size="sm" width="auto" disabled={disabled} aria-pressed={allSelected}
        onClick={() => change(allSelected ? current.filter((item) => !enabled.includes(item)) : [...new Set([...current, ...enabled])])}>Any time</Button>
      <Button variant="tertiary" disabled={disabled || current.length === 0} onClick={() => change([])}>Clear selection</Button>
    </div>}
    <div className={styles.windowDays}>
      {days.map((day) => <fieldset key={day.value} className={styles.day}>
        <legend>{day.label}</legend>
        <div className={styles.windowOptions}>
          {day.windows.map((window) => <label key={window.value} className={styles.windowTarget} data-disabled={disabled || window.disabled || undefined}>
            <input className={styles.choiceInput} type="checkbox" name={name} value={window.value}
              disabled={window.disabled} checked={current.includes(window.value)}
              aria-label={`${day.label}, ${window.label}`} aria-describedby={field.describedBy}
              aria-invalid={error ? true : undefined}
              onChange={(event) => change(event.target.checked ? [...current, window.value] : current.filter((item) => item !== window.value))} />
            <span className={styles.window}>{window.label}</span>
          </label>)}
        </div>
      </fieldset>)}
    </div>
    {enabled.length === 0 && <p className={styles.hint}>{emptyMessage}</p>}
    <p className={styles.hint} role="status">{current.length} time {current.length === 1 ? "window" : "windows"} selected</p>
  </fieldset>;
}
