"use client";

import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";

import { Button, IconButton } from "@/components/Button";
import {
  AddressField, type AddressSuggestion, CheckboxField, ChipGroup, DateField, MoneyField, PasswordField,
  RadioGroup, SelectField, SwitchField, TextAreaField, TextField, TimeWindowPicker, type TimeWindowDay,
} from "@/components/forms";
import { useDebouncedValue } from "@/lib/motion/hooks";

import styles from "./fields.module.css";

export type PreviewState = "default" | "error" | "disabled" | "success";

const TRADES = [{ value: "electrical", label: "Electrical" }, { value: "plumbing", label: "Plumbing" }, { value: "other", label: "Other / general labour" }];
const ADDRESSES: AddressSuggestion[] = [
  { id: "demo-1", label: "12 Demo Street, Gladstone", detail: "Invercargill · example address" },
  { id: "demo-2", label: "12 Demo Road, Windsor", detail: "Invercargill · example address" },
  { id: "demo-3", label: "12 Demo Place, Richmond", detail: "Invercargill · example address" },
];
// Fixed sample dates make review screenshots repeatable. Real pages supply their own dates and availability.
const DAYS: TimeWindowDay[] = Array.from({ length: 7 }, (_, index) => ({
  value: `2026-11-${String(index + 2).padStart(2, "0")}`,
  label: `${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][index]} ${index + 2} Nov`,
  windows: ["Morning", "Afternoon", "Evening"].map((label) => ({
    value: `2026-11-${String(index + 2).padStart(2, "0")}:${label.toLowerCase()}`, label,
    disabled: index === 0 && label === "Morning",
  })),
}));

function Section({ id, title, intro, children }: { id: string; title: string; intro: string; children: ReactNode }) {
  return <section id={id} aria-labelledby={`${id}-title`} className={styles.section}>
    <div className={styles.sectionHead}><p className={styles.sectionNumber}>{id === "text" ? "01" : id === "choices" ? "02" : id === "booking" ? "03" : id === "address" ? "04" : id === "edge-cases" ? "05" : "06"}</p>
      <div><h2 id={`${id}-title`}>{title}</h2><p>{intro}</p></div>
    </div>{children}
  </section>;
}

export function FieldDemos({ initialState }: { initialState: PreviewState }) {
  const [state, setState] = useState<PreviewState>(initialState);
  const disabled = state === "disabled";
  const messages = { disabled, error: state === "error" ? "Check this field and try again." : undefined,
    success: state === "success" ? "Looks good." : undefined };
  return <>
    <div className={styles.previewBar}>
      <ChipGroup label="Preview state" name="preview-state" value={state} onChange={(value) => setState(value as PreviewState)}
        options={[{ value: "default", label: "Default" }, { value: "error", label: "Error" }, { value: "disabled", label: "Disabled" }, { value: "success", label: "Success" }]} />
      <p className={styles.note}>Tab to a field to see focus. Switching states keeps your values.</p>
    </div>
    <Section id="text" title="Text & numbers" intro="Underline fields for simple forms. Square boxes when there’s a little more to say.">
      <div className={styles.twoColumns}>
        <div className={styles.panel}>
          <h3>Simple forms</h3>
          <TextField {...messages} label="Full name" name="full-name" variant="underline" icon="person" autoComplete="name" placeholder="Your name" />
          <TextField {...messages} label="Email" name="email" variant="underline" type="email" icon="mail" autoComplete="email" placeholder="you@example.co.nz" />
          <PasswordField {...messages} label="Password" name="password" autoComplete="new-password" hint="At least 10 characters." placeholder="Choose a password" />
          <TextField {...messages} label="Phone" name="phone" variant="underline" type="tel" icon="call" autoComplete="tel" placeholder="021 123 4567" />
        </div>
        <div className={styles.panel}>
          <h3>A bit more detail</h3>
          <TextField {...messages} label="Job title" name="job-title" placeholder="What needs doing?" hint="A short description is plenty." required />
          <div className={styles.twoColumns}>
            <TextField {...messages} label="Hours" name="hours" type="number" min="0" step="0.5" suffix="h" placeholder="0" />
            <MoneyField {...messages} label="Materials (NZD)" name="materials" placeholder="0.00" hint="Example input only." />
          </div>
          <SelectField {...messages} label="Trade" name="trade" defaultValue="" required>
            <option value="" disabled>Choose a trade</option>{TRADES.map((trade) => <option key={trade.value} value={trade.value}>{trade.label}</option>)}
          </SelectField>
          <TextAreaField {...messages} label="Tell us about the job" name="description" maxLength={500} placeholder="What’s happening, and what would you like sorted?" />
        </div>
      </div>
    </Section>
    <Section id="choices" title="Choices, big & small" intro="Familiar controls with a clear selected state. Every label is part of the tap target.">
      <div className={styles.twoColumns}>
        <div className={styles.panel}><h3>Checks & switches</h3>
          <CheckboxField {...messages} label="Keep me logged in" name="remember" defaultChecked />
          <CheckboxField {...messages} label="I have access to the property" name="access" card hint="You can add access notes when posting." />
          <SwitchField {...messages} label="Available for new jobs" name="available" defaultChecked hint="Switch off to browse quietly." />
          <SwitchField {...messages} label="Email job updates" name="email-updates" />
        </div>
        <div className={styles.panel}><h3>One choice</h3>
          <RadioGroup {...messages} label="Who is the job for?" name="job-for" defaultValue="home"
            options={[{ value: "home", label: "My home", hint: "A place you live in." }, { value: "rental", label: "A rental property" }, { value: "business", label: "A business", disabled: true }]} />
        </div>
      </div>
      <div className={styles.panel}>
        <ChipGroup {...messages} label="Pick one trade" name="trade-chip" options={TRADES} defaultValue="electrical" />
        <ChipGroup {...messages} label="Pick any that apply" name="job-tags" multiple defaultValue={["inside"]}
          options={[{ value: "inside", label: "Inside" }, { value: "outside", label: "Outside" }, { value: "ladder", label: "Needs a ladder" }, { value: "other", label: "Something else" }]} />
      </div>
    </Section>
    <Section id="booking" title="A time that suits" intro="A native date picker, plus a week of selectable windows. Unavailable windows stay clearly marked.">
      <div className={styles.bookingGrid}>
        <div className={styles.panel}>
          <TimeWindowPicker {...messages} label="When are you free?" name="time-windows" days={DAYS}
            defaultValue={[DAYS[1].windows[1].value]} hint="Choose as many windows as you like. Dates shown are examples." />
        </div>
        <div className={styles.panel}>
          <h3>Dates & availability</h3>
          <DateField {...messages} label="Preferred date" name="preferred-date" defaultValue="2026-11-03" min="2026-11-02" max="2026-11-08" />
          <CheckboxField {...messages} label="As soon as possible" name="asap" hint="The form decides what this means for the job." />
          <TimeWindowPicker label="No availability" name="empty-windows" days={[]} />
          <TextField label="Job number" name="job-number" defaultValue="TM-1005" readOnly hint="Read only. You can still copy it." />
        </div>
      </div>
    </Section>
    <Section id="address" title="Find the right place" intro="Try “Demo” for sample suggestions, or “offline” for the fallback. These examples don’t contact an address service.">
      <div className={styles.twoColumns}>
        <div className={styles.panel}><h3>Try address search</h3><AddressDemo disabled={disabled} error={messages.error} success={messages.success} /></div>
        <div className={styles.panel}><h3>Search states</h3>
          <AddressField label="Loading example" name="address-loading" defaultValue="12 Demo" suggestions={[]} status="loading" />
          <AddressField label="No matches example" name="address-empty" defaultValue="No matching address" suggestions={[]} status="ready" />
          <AddressField label="Offline example" name="address-offline" defaultValue="12 Demo Street" suggestions={[]} status="error" />
        </div>
      </div>
    </Section>
    <Section id="edge-cases" title="Room for real life" intro="Long names, long notes and 200% zoom. Labels wrap, input values scroll inside their field, and nothing pushes the page sideways.">
      <div className={styles.panel}>
        <TextField label="Name of the person meeting the tradie at the property, including any extra directions for finding them"
          defaultValue="Wiremu Te Rangi-Hēnare from Ōtautahi Electrical Services in Papatoetoe" hint="The whole value is available for editing and copying." />
        <TextAreaField label="Long access notes" maxLength={500} defaultValue="Taumatawhakatangihangakoauauotamateaturipukakapikimaungahoronukupokaiwhenuakitanatahu. Please come around the back of the property and ring before arriving." />
        <ChipGroup label="Long choice labels" multiple name="long-chips" options={[{ value: "long", label: "Electrical work at a rental property with a particularly long suburb and street name" }]} />
        <CheckboxField label="Please call Wiremu Te Rangi-Hēnare from Ōtautahi Electrical Services before arriving at the rear entrance" />
      </div>
    </Section>
    <Section id="usage" title="Try a form" intro="Submit it empty, then fix the highlighted fields. Your entries stay put. This is a local example; nothing is sent or saved.">
      <UsageExample />
    </Section>
  </>;
}

function AddressDemo({ disabled, error, success }: { disabled: boolean; error?: string; success?: string }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const debounced = useDebouncedValue(query, 150);
  const lookup = query.trim().length < 2 ? "idle" : query !== debounced ? "loading" : debounced.toLowerCase() === "offline" ? "error" : "ready";
  const suggestions = ADDRESSES.filter((option) => option.label.toLowerCase().includes(debounced.toLowerCase()));
  return <>
    <AddressField label="Property address" name="property-address" value={query} suggestions={suggestions} status={lookup}
      {...{ disabled, error, success }} hint="Type at least two characters. Example addresses only."
      onQueryChange={(value) => { setQuery(value); setSelected(null); }} onSelect={(option) => setSelected(option.label)} />
    <p className={styles.note} role="status">{selected ? `Selected: ${selected}` : "No address selected yet."}</p>
  </>;
}

type ExampleValues = { name: string; email: string; description: string; trade: string; agreed: boolean };
type ExampleErrors = Partial<Record<keyof ExampleValues, string>>;
export function validateExample(values: ExampleValues): ExampleErrors {
  return {
    ...(!values.name.trim() && { name: "Add your name." }),
    ...(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email) && { email: "Add a valid email address." }),
    ...(!values.description.trim() && { description: "Tell us what needs doing." }),
    ...(!values.trade && { trade: "Choose a trade." }),
    ...(!values.agreed && { agreed: "Confirm that you can provide access." }),
  };
}

export function UsageExample() {
  const form = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState<ExampleValues>({ name: "", email: "", description: "", trade: "", agreed: false });
  const [errors, setErrors] = useState<ExampleErrors>({});
  const [phase, setPhase] = useState<"idle" | "error" | "loading" | "success">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (phase === "loading") return;
    const next = validateExample(values);
    setErrors(next);
    if (Object.keys(next).length) {
      setPhase("error");
      // Wait for React to render the field error and its association, then focus the first invalid control.
      requestAnimationFrame(() => form.current?.querySelector<HTMLElement>("[aria-invalid=true]")?.focus());
    } else {
      setPhase("loading");
      timer.current = setTimeout(() => setPhase("success"), 700);
    }
  }
  return <form ref={form} noValidate onSubmit={submit} className={styles.example} aria-label="Form field usage example" aria-busy={phase === "loading"}>
    <div className={styles.exampleHeading}><div><p className={styles.note}>Example only</p><h3>What needs sorting?</h3></div>
      <IconButton icon="restart_alt" label="Reset example" disabled={phase === "loading"} onClick={() => {
        setValues({ name: "", email: "", description: "", trade: "", agreed: false }); setErrors({}); setPhase("idle");
      }} /></div>
    <div className={styles.twoColumns}>
      <TextField label="Your name" name="example-name" required disabled={phase === "loading"} autoComplete="name" value={values.name} error={errors.name}
        onChange={(event) => setValues({ ...values, name: event.target.value })} />
      <TextField label="Your email" name="example-email" type="email" required disabled={phase === "loading"} autoComplete="email" value={values.email} error={errors.email}
        onChange={(event) => setValues({ ...values, email: event.target.value })} />
    </div>
    <SelectField label="Type of job" name="example-trade" required disabled={phase === "loading"} value={values.trade} error={errors.trade}
      onChange={(event) => setValues({ ...values, trade: event.target.value })}>
      <option value="">Choose a trade</option>{TRADES.map((trade) => <option key={trade.value} value={trade.value}>{trade.label}</option>)}
    </SelectField>
    <TextAreaField label="What needs doing?" name="example-description" required disabled={phase === "loading"} maxLength={500} value={values.description} error={errors.description}
      onChange={(event) => setValues({ ...values, description: event.target.value })} />
    <CheckboxField label="I can provide access to the property" name="example-access" required disabled={phase === "loading"} checked={values.agreed} error={errors.agreed}
      onChange={(event) => setValues({ ...values, agreed: event.target.checked })} />
    <div className={styles.formStatus} role="status">{phase === "error" ? "Check the highlighted fields. Your entries are still here."
      : phase === "loading" ? "Checking your example…" : phase === "success" ? "All good. This example hasn’t sent or saved anything." : ""}</div>
    <Button type="submit" loading={phase === "loading"}>Check example</Button>
  </form>;
}
