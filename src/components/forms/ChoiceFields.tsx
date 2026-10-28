"use client";

import { type InputHTMLAttributes, type ReactNode, type Ref, useId } from "react";

import { Icon } from "@/components/Icon";

import { FieldMessages, type FieldMessageProps, useField } from "./Field";
import styles from "./forms.module.css";

export type CheckboxFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size"> & Omit<FieldMessageProps, "label"> & {
  label: ReactNode;
  card?: boolean;
  ref?: Ref<HTMLInputElement>;
};

export function CheckboxField({ label, hint, error, success, required, id, className, card, "aria-describedby": describedBy,
  ...input }: CheckboxFieldProps) {
  const field = useField({ id, hint, error, success, describedBy });
  return <div className={[styles.field, className].filter(Boolean).join(" ")}>
    <label className={card ? styles.choiceCard : styles.choice} data-disabled={input.disabled || undefined}>
      <input {...input} id={field.id} type="checkbox" required={required} className={styles.choiceInput}
        aria-invalid={error ? true : undefined} aria-describedby={field.describedBy} />
      <span className={styles.check} aria-hidden="true"><Icon name="check" size="sm" decorative /></span>
      <span className={styles.choiceLabel}>{label}{required && <span className={styles.required} hidden> (required)</span>}</span>
    </label>
    <FieldMessages id={field.id} {...{ hint, error, success }} />
  </div>;
}

export function SwitchField({ label, hint, error, success, required, id, className, "aria-describedby": describedBy,
  ...input }: Omit<CheckboxFieldProps, "card">) {
  const field = useField({ id, hint, error, success, describedBy });
  return <div className={[styles.field, className].filter(Boolean).join(" ")}>
    <label className={styles.choice} data-disabled={input.disabled || undefined}>
      <input {...input} id={field.id} type="checkbox" role="switch" required={required} className={styles.choiceInput}
        aria-invalid={error ? true : undefined} aria-describedby={field.describedBy} />
      <span className={styles.switchTrack} aria-hidden="true"><span /></span>
      <span className={styles.choiceLabel}>{label}{required && <span className={styles.required} hidden> (required)</span>}</span>
    </label>
    <FieldMessages id={field.id} {...{ hint, error, success }} />
  </div>;
}

export type ChoiceOption = { value: string; label: string; hint?: string; disabled?: boolean };
export type RadioGroupProps = FieldMessageProps & {
  name: string;
  options: readonly ChoiceOption[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
};

export function RadioGroup({ label, hint, error, success, required, name, options, value, defaultValue,
  onChange, disabled, id, className }: RadioGroupProps) {
  const field = useField({ id, hint, error, success });
  return <fieldset id={field.id} className={[styles.group, className].filter(Boolean).join(" ")} disabled={disabled}
    aria-describedby={field.describedBy} aria-invalid={error ? true : undefined}>
    <legend className={styles.legend}>{label}{required && <span className={styles.required} hidden> (required)</span>}</legend>
    <div className={styles.optionStack}>
      {options.map((option) => <label key={option.value} className={styles.choiceCard} data-disabled={disabled || option.disabled || undefined}>
        <input type="radio" name={name} value={option.value} required={required} disabled={option.disabled}
          checked={value === undefined ? undefined : value === option.value}
          defaultChecked={value === undefined ? defaultValue === option.value : undefined}
          onChange={() => onChange?.(option.value)} className={styles.choiceInput} aria-describedby={field.describedBy} />
        <span className={styles.radio} aria-hidden="true" />
        <span className={styles.choiceLabel}>{option.label}{option.hint && <span hidden>{option.hint}</span>}</span>
      </label>)}
    </div>
    <FieldMessages id={field.id} {...{ hint, error, success }} />
  </fieldset>;
}

type ChipCommon = FieldMessageProps & {
  name?: string; hideLabel?: boolean; options: readonly ChoiceOption[]; disabled?: boolean; id?: string; className?: string;
};
export type ChipGroupProps = ChipCommon & (
  { multiple: true; value?: readonly string[]; defaultValue?: readonly string[]; onChange?: (values: string[]) => void } |
  { multiple?: false; value?: string; defaultValue?: string; onChange?: (value: string) => void }
);

/** Real radios/checkboxes styled as chips: arrow keys for one choice, Space for independent choices. */
export function ChipGroup(props: ChipGroupProps) {
  const { label, hint, error, success, required, options, disabled, id, className, hideLabel } = props;
  const generatedName = useId();
  const name = props.name ?? `chips-${generatedName}`;
  const field = useField({ id, hint, error, success });
  return <fieldset aria-label={hideLabel ? label : undefined} id={field.id} className={[styles.group, className].filter(Boolean).join(" ")} disabled={disabled}
    aria-describedby={field.describedBy} aria-invalid={error ? true : undefined}>
    <legend className={styles.legend} hidden={hideLabel}>{label}{required && <span className={styles.required} hidden> (required)</span>}</legend>
    <div className={styles.chips}>
      {options.map((option) => {
        const checked = props.value === undefined ? undefined : props.multiple ? props.value.includes(option.value) : props.value === option.value;
        const defaultChecked = props.value !== undefined ? undefined : props.multiple ? props.defaultValue?.includes(option.value) : props.defaultValue === option.value;
        return <label className={styles.chipTarget} key={option.value} data-disabled={disabled || option.disabled || undefined}>
          <input type={props.multiple ? "checkbox" : "radio"} name={name} value={option.value} disabled={option.disabled}
            required={required && !props.multiple} checked={checked} defaultChecked={defaultChecked} className={styles.choiceInput}
            aria-describedby={field.describedBy} aria-invalid={props.multiple && error ? true : undefined}
            onChange={(event) => {
              if (props.multiple) {
                const formGroup = event.currentTarget.closest("fieldset");
                const values = Array.from(formGroup?.querySelectorAll<HTMLInputElement>("input:checked") ?? [], (input) => input.value);
                props.onChange?.(values);
              } else props.onChange?.(option.value);
            }} />
          <span className={styles.chip}>{option.label}</span>
        </label>;
      })}
    </div>
    <FieldMessages id={field.id} {...{ hint, error, success }} />
  </fieldset>;
}
