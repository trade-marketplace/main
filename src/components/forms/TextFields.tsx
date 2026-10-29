"use client";

import { type InputHTMLAttributes, type Ref, type SelectHTMLAttributes, type TextareaHTMLAttributes, useState } from "react";

import { IconButton } from "@/components/Button";
import { Icon } from "@/components/Icon";

import { Field, type FieldMessageProps, useField } from "./Field";
import styles from "./forms.module.css";

type InputType = "text" | "email" | "tel" | "url" | "search" | "number" | "date";
export type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size" | "type" | "prefix"> & FieldMessageProps & {
  type?: InputType;
  variant?: "box" | "underline";
  icon?: string;
  prefix?: string;
  suffix?: string;
  ref?: Ref<HTMLInputElement>;
};

export function TextField({
  label, labelHidden, hint, error, success, required, id, variant = "box", icon, prefix, suffix, className,
  type = "text", "aria-describedby": describedBy, ...input
}: TextFieldProps) {
  const field = useField({ id, hint, error, success, describedBy });
  return <Field {...{ label, labelHidden, hint, error, success, required }} id={field.id} className={className}>
    <div className={styles.control} data-variant={variant} data-error={Boolean(error)} data-disabled={input.disabled || undefined}>
      {icon && <Icon name={icon} size="sm" decorative />}
      {prefix && <span className={styles.affix} aria-hidden="true">{prefix}</span>}
      <input {...input} type={type} id={field.id} required={required} aria-invalid={error ? true : undefined}
        aria-describedby={field.describedBy} className={styles.input} />
      {suffix && <span className={styles.affix} aria-hidden="true">{suffix}</span>}
      {success && !error && <Icon name="check" size="sm" decorative />}
    </div>
  </Field>;
}

export type PasswordFieldProps = Omit<TextFieldProps, "type" | "prefix" | "suffix">;

export function PasswordField({ label, hint, error, success, required, id, variant = "underline", className,
  icon = "lock", "aria-describedby": describedBy, ...input }: PasswordFieldProps) {
  const field = useField({ id, hint, error, success, describedBy });
  const [visible, setVisible] = useState(false);
  return <Field {...{ label, hint, error, success, required }} id={field.id} className={className}>
    <div className={styles.control} data-variant={variant} data-error={Boolean(error)} data-disabled={input.disabled || undefined}>
      <Icon name={icon} size="sm" decorative />
      <input {...input} type={visible ? "text" : "password"} autoComplete={input.autoComplete ?? "current-password"}
        id={field.id} required={required} aria-invalid={error ? true : undefined} aria-describedby={field.describedBy} className={styles.input} />
      <IconButton icon={visible ? "visibility_off" : "visibility"} label={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`}
        aria-controls={field.id} pressed={visible} disabled={input.disabled} onClick={() => setVisible(!visible)} />
    </div>
  </Field>;
}

/** Keep the editable decimal string intact; the consuming form validates and converts it to cents. */
export function MoneyField(props: Omit<TextFieldProps, "type" | "prefix" | "inputMode">) {
  return <TextField {...props} type="text" inputMode="decimal" prefix="$" />;
}

export function DateField(props: Omit<TextFieldProps, "type">) {
  return <TextField {...props} type="date" />;
}

export type TextAreaFieldProps = TextareaHTMLAttributes<HTMLTextAreaElement> & FieldMessageProps & { ref?: Ref<HTMLTextAreaElement> };

export function TextAreaField({ label, hint, error, success, required, id, className, value, defaultValue, onChange,
  maxLength, "aria-describedby": describedBy, ...input }: TextAreaFieldProps) {
  const [ownValue, setOwnValue] = useState(String(defaultValue ?? ""));
  const current = value === undefined ? ownValue : String(value);
  const field = useField({ id, hint, error, success, describedBy });
  return <Field {...{ label, hint, error, success, required }} id={field.id} className={className}>
    <div className={styles.control} data-variant="box" data-error={Boolean(error)} data-disabled={input.disabled || undefined}>
      <textarea {...input} id={field.id} required={required} value={value} defaultValue={defaultValue} maxLength={maxLength}
        rows={input.rows ?? 4} aria-invalid={error ? true : undefined}
        aria-describedby={[field.describedBy, maxLength !== undefined && `${field.id}-counter`].filter(Boolean).join(" ") || undefined}
        className={styles.textarea} onChange={(event) => { setOwnValue(event.target.value); onChange?.(event); }} />
    </div>
    {maxLength !== undefined && <p id={`${field.id}-counter`} className={styles.counter}>{current.length} / {maxLength}</p>}
  </Field>;
}

export type SelectFieldProps = SelectHTMLAttributes<HTMLSelectElement> & FieldMessageProps & { ref?: Ref<HTMLSelectElement> };

/** Native select: touch picker, type-ahead and keyboard behaviour stay with the browser. */
export function SelectField({ label, hint, error, success, required, id, className, children,
  "aria-describedby": describedBy, ...input }: SelectFieldProps) {
  const field = useField({ id, hint, error, success, describedBy });
  return <Field {...{ label, hint, error, success, required }} id={field.id} className={className}>
    <div className={styles.control} data-variant="box" data-error={Boolean(error)} data-disabled={input.disabled || undefined}>
      <select {...input} id={field.id} required={required} aria-invalid={error ? true : undefined}
        aria-describedby={field.describedBy} className={styles.select}>{children}</select>
    </div>
  </Field>;
}
