"use client";

import { type ReactNode, useId } from "react";

import { Icon } from "@/components/Icon";

import styles from "./forms.module.css";

export type FieldMessageProps = {
  label: string;
  hint?: string;
  error?: string;
  success?: string;
  required?: boolean;
};

/** One stable association between a control, its visible label and all its messages. */
export function useField({ id, hint, error, success, describedBy }: {
  id?: string; hint?: string; error?: string; success?: string; describedBy?: string;
}) {
  const generated = useId();
  const fieldId = id ?? `field-${generated}`;
  return {
    id: fieldId,
    describedBy: [describedBy, hint && `${fieldId}-hint`, error && `${fieldId}-error`, success && !error && `${fieldId}-success`]
      .filter(Boolean).join(" ") || undefined,
  };
}

export function FieldMessages({ id, hint, error, success }: Omit<FieldMessageProps, "label"> & { id: string }) {
  return <>
    {hint && <p id={`${id}-hint`} hidden>{hint}</p>}
    {error && <p id={`${id}-error`} className={styles.error}><Icon name="error" size="sm" decorative />{error}</p>}
    {success && !error && <p className={styles.success}><Icon name="check_circle" size="sm" decorative /><span id={`${id}-success`} hidden>{success}</span></p>}
  </>;
}

export function Field({ id, label, hint, error, success, children, className }: FieldMessageProps & {
  id: string; children: ReactNode; className?: string;
}) {
  return <div className={[styles.field, className].filter(Boolean).join(" ")}>
    <label className={styles.label} htmlFor={id}>{label}</label>
    {children}
    <FieldMessages id={id} hint={hint} error={error} success={success} />
  </div>;
}
