"use client";
// The filter bar (#80): the office "All jobs" mockup (w-o-jobs). A search box, one chip per filter that opens a
// menu of its choices ("Status: Active ⌄"; filled when it isn't on its default), Clear filters, and saved
// filters: name the current set, pick it again later. On a phone the search takes the full width and the chips
// wrap under it.
//
//   <FilterBar
//     label="Filter jobs"
//     search={{ label: "Search jobs", placeholder: "Search", value: q, onChange: setQ }}
//     filters={[{ key: "status", label: "Status", defaultValue: "all", options: [{ value: "all", label: "All" }, …] }]}
//     values={filters}
//     onChange={setFilters}
//     saved={{ filters: savedFilters, onSave: (name) => save(name, filters) }}
//   />
//
// The bar shows and changes the values; the page keeps them in the URL (filtersToQuery / filtersFromQuery in
// src/lib/data-table.ts) and fetches the list. Where saved filters are kept (per office user) is up to the page.
import { type FormEvent, useId, useState } from "react";

import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { TextField } from "@/components/forms";
import { Dialog, Menu, MenuItem, MenuSeparator } from "@/components/overlays";
import { type FilterDefaults, type FilterValues, hasActiveFilters, sameFilters } from "@/lib/data-table";

import styles from "./data.module.css";

export type FilterOption = { value: string; label: string };

export type FilterDefinition = {
  key: string;
  /** "Status": the chip reads "Status: Active". */
  label: string;
  options: readonly FilterOption[];
  /** The value that means "not filtering" ("all"). The chip is filled when it's anything else. */
  defaultValue: string;
};

export type SavedFilter = { id: string; name: string; values: FilterValues };

export type SearchProps = {
  /** Its accessible name: "Search jobs". */
  label: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
};

export type FilterBarProps = {
  /** What the bar filters, for screen readers: "Filter jobs". */
  label: string;
  search?: SearchProps;
  filters: readonly FilterDefinition[];
  values: FilterValues;
  onChange: (values: FilterValues) => void;
  /** Saved filters: the chip and its menu show only when this is given. */
  saved?: {
    filters: readonly SavedFilter[];
    /** Save the filters on screen under this name. */
    onSave: (name: string) => void;
  };
  /** Start with one menu open, for previews and screenshots: a filter's key, or "saved". */
  defaultOpen?: string;
  className?: string;
};

/** The longest name a saved filter can have. Long enough for "Overdue electrical, Invercargill". */
export const SAVED_NAME_MAX = 40;

export function defaultsOf(filters: readonly FilterDefinition[]): FilterDefaults {
  return Object.fromEntries(filters.map((filter) => [filter.key, filter.defaultValue]));
}

export function FilterBar({ label, search, filters, values, onChange, saved, defaultOpen, className }: FilterBarProps) {
  const defaults = defaultsOf(filters);
  const filtered = hasActiveFilters(values, defaults) || Boolean(search?.value.trim());

  const clear = () => {
    onChange({ ...defaults });
    search?.onChange("");
  };

  return (
    <div role="search" aria-label={label} className={[styles.filterBar, className].filter(Boolean).join(" ")}>
      {search && <SearchInput {...search} />}
      {filters.map((filter) => (
        <FilterChip
          key={filter.key}
          filter={filter}
          value={values[filter.key] ?? filter.defaultValue}
          defaultOpen={defaultOpen === filter.key}
          onChange={(value) => onChange({ ...values, [filter.key]: value })}
        />
      ))}
      {saved && <SavedFilters {...saved} defaultOpen={defaultOpen === "saved"} values={values} defaults={defaults} onApply={(next) => onChange({ ...defaults, ...next })} />}
      {filtered && (
        <span className={styles.clear}>
          <Button variant="tertiary" onClick={clear}>
            Clear filters
          </Button>
        </span>
      )}
    </div>
  );
}

/** The search box (web.css .w-search on white): a magnifier, the input and a × to clear it. */
export function SearchInput({ label, placeholder = "Search", value, onChange }: SearchProps) {
  const id = useId();
  return (
    <div className={styles.search}>
      <Icon name="search" size="sm" decorative />
      <input
        id={id}
        type="search"
        className={styles.searchInput}
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && value) {
            event.preventDefault();
            onChange("");
          }
        }}
        autoComplete="off"
        enterKeyHint="search"
      />
      {value && (
        <button
          type="button"
          className={styles.searchClear}
          aria-label="Clear search"
          onClick={() => {
            onChange("");
            document.getElementById(id)?.focus();
          }}
        >
          <Icon name="close" size="sm" decorative />
        </button>
      )}
    </div>
  );
}

/** One filter: a chip that says the current choice and opens a menu of the others. */
export function FilterChip({ filter, value, onChange, defaultOpen }: { filter: FilterDefinition; value: string; onChange: (value: string) => void; defaultOpen?: boolean }) {
  const current = filter.options.find((option) => option.value === value) ?? filter.options.find((option) => option.value === filter.defaultValue);
  const on = value !== filter.defaultValue;
  return (
    <Menu
      align="start"
      label={filter.label}
      defaultOpen={defaultOpen}
      trigger={(props) => (
        <button type="button" className={styles.chipButton} {...props} aria-label={`${filter.label}: ${current?.label ?? ""}`}>
          <span className={styles.chip} data-on={on || undefined}>
            <span className={styles.chipLabel}>
              {filter.label}: {current?.label}
            </span>
            <Icon name="expand_more" size="sm" decorative className={`${styles.chipIcon} ${styles.chipChevron}`} />
          </span>
        </button>
      )}
    >
      {filter.options.map((option) => (
        <MenuItem key={option.value} checked={option.value === (current?.value ?? value)} onSelect={() => onChange(option.value)}>
          {option.label}
        </MenuItem>
      ))}
    </Menu>
  );
}

type SavedFiltersProps = NonNullable<FilterBarProps["saved"]> & {
  values: FilterValues;
  defaults: FilterDefaults;
  onApply: (values: FilterValues) => void;
  defaultOpen?: boolean;
};

/** "Saved filters": pick one to apply it, or save what's on screen under a name. */
export function SavedFilters({ filters, onSave, values, defaults, onApply, defaultOpen }: SavedFiltersProps) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const formId = useId();
  const current = filters.find((saved) => sameFilters(saved.values, values, defaults));
  const canSave = hasActiveFilters(values, defaults);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setError("Give it a name.");
    if (trimmed.length > SAVED_NAME_MAX) return setError(`Keep it under ${SAVED_NAME_MAX} letters.`);
    if (filters.some((saved) => saved.name.toLowerCase() === trimmed.toLowerCase())) return setError("You already have one with that name.");
    onSave(trimmed);
    setNaming(false);
  };

  return (
    <>
      <Menu
        align="start"
        label="Saved filters"
        defaultOpen={defaultOpen}
        header={filters.length === 0 ? <span>None saved yet. Pick some filters, then save them here.</span> : undefined}
        trigger={(props) => (
          <button
            type="button"
            className={styles.chipButton}
            {...props}
            aria-label={current ? `Saved filters: ${current.name}` : "Saved filters"}
          >
            <span className={styles.chip} data-on={current ? true : undefined}>
              <Icon name="bookmark" fill={Boolean(current)} size="sm" decorative className={styles.chipIcon} />
              <span className={styles.chipLabel}>{current ? current.name : "Saved filters"}</span>
              <Icon name="expand_more" size="sm" decorative className={`${styles.chipIcon} ${styles.chipChevron}`} />
            </span>
          </button>
        )}
      >
        {filters.map((saved) => (
          <MenuItem key={saved.id} checked={saved.id === current?.id} onSelect={() => onApply(saved.values)}>
            {saved.name}
          </MenuItem>
        ))}
        {filters.length > 0 && <MenuSeparator />}
        <MenuItem
          icon="bookmark_add"
          disabled={!canSave || Boolean(current)}
          onSelect={() => {
            setName("");
            setError(null);
            setNaming(true);
          }}
        >
          {current ? "These filters are saved" : canSave ? "Save these filters…" : "Save these filters (pick a filter first)"}
        </MenuItem>
      </Menu>
      <Dialog
        open={naming}
        onClose={() => setNaming(false)}
        size="sm"
        title="Save these filters"
        description="They’ll be under Saved filters, just for you."
        footer={
          <>
            <Button variant="secondary" width="auto" onClick={() => setNaming(false)}>
              Cancel
            </Button>
            <Button width="auto" type="submit" form={formId}>
              Save filters
            </Button>
          </>
        }
      >
        <form id={formId} onSubmit={submit} noValidate>
          <TextField
            label="Name"
            value={name}
            maxLength={SAVED_NAME_MAX + 10}
            error={error ?? undefined}
            hint="For example, Overdue to price"
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
            }}
            autoComplete="off"
          />
        </form>
      </Dialog>
    </>
  );
}
