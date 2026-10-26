"use client";

import { useState } from "react";

import { Button } from "@/components/Button";
import { SelectField, TextField } from "@/components/forms";

import styles from "./data.module.css";

export type FilterDefinition = { key: string; label: string; options: readonly { value: string; label: string }[] };
export type FilterSnapshot = { search: string; values: Record<string, string> };
export type SavedFilter = FilterSnapshot & { id: string; name: string };
export type FilterBarProps = {
  label?: string;
  searchLabel?: string;
  filters: readonly FilterDefinition[];
  value: FilterSnapshot;
  onChange: (value: FilterSnapshot) => void;
  savedFilters?: readonly SavedFilter[];
  /** The caller owns persistence (per account on a real page). */
  onSave?: (name: string, value: FilterSnapshot) => void;
  onDeleteSaved?: (id: string) => void;
  disabled?: boolean;
};

export function FilterBar({ label = "Filters", searchLabel = "Search", filters, value, onChange, savedFilters = [], onSave, onDeleteSaved, disabled }: FilterBarProps) {
  const [name, setName] = useState("");
  const active = filters.flatMap((filter) => {
    const option = filter.options.find((option) => option.value === value.values[filter.key] && option.value);
    return option ? [{ key: filter.key, label: `${filter.label}: ${option.label}` }] : [];
  });
  const hasFilters = Boolean(value.search) || active.length > 0;
  return <section aria-label={label} className={styles.filters}>
    <div className={styles.filterFields}>
      <TextField label={searchLabel} type="search" icon="search" value={value.search} disabled={disabled}
        onChange={(event) => onChange({ ...value, search: event.target.value })} />
      {filters.map((filter) => <SelectField key={filter.key} label={filter.label} value={value.values[filter.key] ?? ""} disabled={disabled}
        onChange={(event) => onChange({ ...value, values: { ...value.values, [filter.key]: event.target.value } })}>
        <option value="">All</option>{filter.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </SelectField>)}
    </div>
    {hasFilters && <div className={styles.chips} aria-label="Active filters">
      {value.search && <Button variant="secondary" size="sm" width="auto" iconEnd="close" disabled={disabled}
        aria-label={`Remove search: ${value.search}`} onClick={() => onChange({ ...value, search: "" })}>Search: {value.search}</Button>}
      {active.map((chip) => <Button key={chip.key} variant="secondary" size="sm" width="auto" iconEnd="close" disabled={disabled}
        aria-label={`Remove ${chip.label}`} onClick={() => onChange({ ...value, values: { ...value.values, [chip.key]: "" } })}>{chip.label}</Button>)}
      <Button variant="tertiary" disabled={disabled} onClick={() => onChange({ search: "", values: {} })}>Reset filters</Button>
    </div>}
    {(onSave || savedFilters.length > 0) && <div className={styles.saved}>
      {savedFilters.length > 0 && <div className={styles.chips} aria-label="Saved filters">
        {savedFilters.map((saved) => <span key={saved.id} className={styles.savedPair}>
          <Button variant="secondary" size="sm" width="auto" disabled={disabled} onClick={() => onChange({ search: saved.search, values: { ...saved.values } })}>{saved.name}</Button>
          {onDeleteSaved && <Button variant="tertiary" disabled={disabled} aria-label={`Delete saved filter ${saved.name}`}
            onClick={() => onDeleteSaved(saved.id)}>Delete</Button>}
        </span>)}
      </div>}
      {onSave && <form className={styles.saveForm} onSubmit={(event) => {
        event.preventDefault();
        if (disabled || !hasFilters || !name.trim()) return;
        onSave(name.trim(), { search: value.search, values: { ...value.values } });
        setName("");
      }}>
        <TextField label="Filter name" value={name} maxLength={80} disabled={disabled} onChange={(event) => setName(event.target.value)} />
        <Button type="submit" variant="secondary" width="auto" disabled={disabled || !hasFilters || !name.trim()}>Save filters</Button>
      </form>}
    </div>}
  </section>;
}
