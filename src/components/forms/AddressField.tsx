"use client";

import { type InputHTMLAttributes, type Ref, useEffect, useRef, useState } from "react";

import { Icon } from "@/components/Icon";

import { Field, type FieldMessageProps, useField } from "./Field";
import styles from "./forms.module.css";

export type AddressSuggestion = { id: string; label: string; detail?: string };
export type AddressFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "onSelect" | "type" | "value" | "defaultValue" | "role" | "size"> & FieldMessageProps & {
  value?: string;
  defaultValue?: string;
  suggestions: readonly AddressSuggestion[];
  status?: "idle" | "loading" | "ready" | "error";
  lookupError?: string;
  onQueryChange?: (query: string) => void;
  onSelect?: (suggestion: AddressSuggestion) => void;
  ref?: Ref<HTMLInputElement>;
};

/** Accessible autocomplete shell. Fetching, debounce, coverage and stale-response protection belong to the caller. */
export function AddressField({ label, hint, error, success, required, id, className, value, defaultValue = "",
  suggestions, status = "idle", lookupError = "Address search is unavailable. You can type the address by hand.",
  onQueryChange, onSelect, onFocus, onBlur, onKeyDown, "aria-describedby": describedBy, ...input }: AddressFieldProps) {
  const field = useField({ id, hint, error, success, describedBy });
  const [ownValue, setOwnValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const current = value ?? ownValue;
  const results = status === "ready" ? suggestions : [];
  const expanded = open && !input.disabled && !input.readOnly && status !== "idle";
  const activeIndex = results.findIndex((result) => result.id === active);
  const listId = `${field.id}-list`;
  const statusId = `${field.id}-status`;
  useEffect(() => {
    if (expanded && activeIndex >= 0) list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [expanded, activeIndex]);
  function select(option: AddressSuggestion) {
    setOwnValue(option.label);
    onQueryChange?.(option.label);
    onSelect?.(option);
    setOpen(false);
    setActive(null);
  }
  return <Field {...{ label, hint, error, success, required }} id={field.id} className={className}>
    <div className={styles.address}>
      <div className={styles.control} data-variant="box" data-error={Boolean(error)} data-disabled={input.disabled || undefined}>
        <Icon name="location_on" size="sm" decorative />
        <input {...input} type="text" autoComplete={input.autoComplete ?? "off"} id={field.id} value={current}
          required={required} role="combobox" aria-autocomplete="list" aria-expanded={expanded}
          aria-controls={expanded ? listId : undefined} aria-activedescendant={expanded && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
          aria-describedby={[field.describedBy, status !== "idle" && statusId].filter(Boolean).join(" ") || undefined}
          aria-invalid={error ? true : undefined} className={styles.input}
          onChange={(event) => { setOwnValue(event.target.value); setActive(null); setOpen(true); onQueryChange?.(event.target.value); }}
          onFocus={(event) => { setOpen(true); onFocus?.(event); }} onBlur={(event) => { setOpen(false); setActive(null); onBlur?.(event); }}
          onKeyDown={(event) => {
            onKeyDown?.(event);
            if (event.defaultPrevented || input.readOnly) return;
            if (event.key === "Escape") { event.preventDefault(); setOpen(false); setActive(null); }
            else if ((event.key === "ArrowDown" || event.key === "ArrowUp") && results.length > 0) {
              event.preventDefault(); setOpen(true);
              const index = activeIndex < 0 ? event.key === "ArrowDown" ? 0 : results.length - 1
                : (activeIndex + (event.key === "ArrowDown" ? 1 : -1) + results.length) % results.length;
              setActive(results[index].id);
            } else if (event.key === "Enter" && expanded && activeIndex >= 0) { event.preventDefault(); select(results[activeIndex]); }
          }} />
      </div>
      {expanded && <ul ref={list} id={listId} role="listbox" aria-label={`${label} suggestions`} aria-busy={status === "loading"}
        className={`${styles.suggestions} tm-anim-suggest`}>
        {results.map((option, index) => <li key={option.id} id={`${listId}-${index}`} role="option" aria-selected={option.id === active}
          className={styles.suggestion} onPointerDown={(event) => event.preventDefault()} onPointerMove={() => setActive(option.id)} onClick={() => select(option)}>
          <Icon name="location_on" size="sm" decorative />
          <span>{option.label}{option.detail && <span className={styles.optionHint}>{option.detail}</span>}</span>
        </li>)}
      </ul>}
      <p id={statusId} role="status" className={styles.lookupStatus}>
        {status === "loading" ? "Looking for addresses…" : status === "error" ? lookupError
          : status === "ready" ? results.length === 0 ? "No matches. You can type the address by hand." : `${results.length} suggestions. Use up and down arrows, then Enter to choose.` : ""}
      </p>
    </div>
  </Field>;
}
