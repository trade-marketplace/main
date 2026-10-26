import { renderToStaticMarkup as render } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import FieldsPage from "@/app/dev/components/fields/page";
import { validateExample } from "@/app/dev/components/fields/FieldDemos";
import {
  AddressField, CheckboxField, ChipGroup, DateField, MoneyField, PasswordField, RadioGroup, SelectField,
  SwitchField, TextAreaField, TextField, TimeWindowPicker,
} from "@/components/forms";

const tag = (html: string, name = "input") => html.match(new RegExp(`<${name}\\b[^>]*>`))?.[0] ?? "";

describe("form fields: names, descriptions and form values", () => {
  it("associates the visible label, hint, existing description and inline error with the same stable control", () => {
    const html = render(<TextField id="email" name="email" label="Your email" type="email" required
      hint="Use an address you check." error="Check this email." aria-describedby="form-help" defaultValue="mistyped@" />);
    expect(html).toContain('for="email"');
    expect(tag(html)).toContain('id="email"');
    expect(tag(html)).toContain('name="email"');
    expect(tag(html)).toContain('required=""');
    expect(tag(html)).toContain('aria-invalid="true"');
    expect(tag(html)).toContain('aria-describedby="form-help email-hint email-error"');
    expect(tag(html)).toContain('value="mistyped@"');
    expect(html).toContain('id="email-error"');
  });

  it("makes unique label/control pairs when the caller doesn't supply ids", () => {
    const html = render(<><TextField label="First" /><TextField label="Second" /></>);
    const ids = [...html.matchAll(/<input[^>]* id="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) expect(html).toContain(`for="${id}"`);
  });

  it.each(["text", "email", "tel", "url", "search", "number"] as const)("keeps the native %s type and relevant browser attributes", (type) => {
    const html = tag(render(<TextField type={type} label="Value" name="value" disabled defaultValue="12" />));
    expect(html).toContain(`type="${type}"`);
    expect(html).toContain('disabled=""');
    expect(html).toContain('value="12"');
  });

  it("read-only values can still be read and copied, and successful fields have text as well as an icon", () => {
    const html = render(<TextField label="Job" id="job" readOnly defaultValue="TM-1005" success="Looks good." />);
    expect(tag(html)).toContain('readOnly=""');
    expect(tag(html)).not.toContain('disabled=""');
    expect(tag(html)).toContain('aria-describedby="job-success"');
    expect(html).toContain("Looks good.");
  });

  it("an error wins over success, without clearing a value", () => {
    const html = render(<TextField label="Name" defaultValue="Wiremu" error="Please check." success="Looks good." />);
    expect(html).toContain('value="Wiremu"');
    expect(html).not.toContain("Looks good.");
  });

  it("password visibility starts off and uses a named non-submit button linked to the input", () => {
    const html = render(<PasswordField id="secret" label="Password" name="password" autoComplete="new-password" />);
    expect(tag(html)).toContain('type="password"');
    expect(tag(html)).toContain('autoComplete="new-password"');
    expect(tag(html, "button")).toContain('type="button"');
    expect(tag(html, "button")).toContain('aria-label="Show password"');
    expect(tag(html, "button")).toContain('aria-controls="secret"');
  });

  it("money stays an editable decimal string, with a NZD label and no rounding or pricing maths", () => {
    const html = render(<MoneyField label="Materials (NZD)" name="materials" defaultValue="12.50" />);
    expect(tag(html)).toContain('inputMode="decimal"');
    expect(tag(html)).toContain('type="text"');
    expect(tag(html)).toContain('value="12.50"');
    expect(html).toContain(">$</span>");
  });

  it("uses a native date input and passes through ISO date bounds", () => {
    const html = tag(render(<DateField label="Date" min="2026-11-02" max="2026-11-08" defaultValue="2026-11-03" />));
    expect(html).toContain('type="date"');
    expect(html).toContain('min="2026-11-02"');
    expect(html).toContain('max="2026-11-08"');
    expect(html).toContain('value="2026-11-03"');
  });

  it("describes a textarea with its live counter, hint and error without truncating saved long content", () => {
    const long = "Taumatawhakatangihangakoauauotamateaturipukakapikimaungahoronukupokaiwhenuakitanatahu";
    const html = render(<TextAreaField id="notes" label="Notes" hint="Directions help." maxLength={200} defaultValue={long} error="Please check." />);
    expect(tag(html, "textarea")).toContain('aria-describedby="notes-hint notes-error notes-counter"');
    expect(html).toContain(`${long.length} / 200 characters`);
    expect(html).toContain(long);
  });

  it("leaves selects native for keyboard type-ahead and the phone picker", () => {
    const html = render(<SelectField label="Trade" name="trade" defaultValue="other"><option value="other">Other</option></SelectField>);
    expect(tag(html, "select")).toContain('name="trade"');
    expect(html).toContain('<option value="other" selected="">Other</option>');
  });
});

describe("choices and time windows", () => {
  it("checkboxes and switches submit native values and expose the correct checked state", () => {
    expect(tag(render(<CheckboxField label="Keep me logged in" name="remember" value="yes" defaultChecked />))).toContain('checked=""');
    const control = tag(render(<SwitchField label="Available" name="available" defaultChecked />));
    expect(control).toContain('role="switch"');
    expect(control).toContain('type="checkbox"');
    expect(control).toContain('checked=""');
  });

  it("radio choices share a name and one default, and a disabled option remains unavailable", () => {
    const html = render(<RadioGroup label="Who for?" name="who" defaultValue="home" options={[
      { value: "home", label: "Home" }, { value: "work", label: "Work", disabled: true },
    ]} />);
    expect(html).toContain("<legend");
    expect(html.match(/name="who"/g)).toHaveLength(2);
    expect(html.match(/checked=""/g)).toHaveLength(1);
    expect(html.match(/<input[^>]*value="work"[^>]*>/)?.[0]).toContain('disabled=""');
  });

  it("single chips are radios and multiple chips are checkboxes, with full long accessible labels", () => {
    const options = [{ value: "a", label: "A very long suburb and street name that must never disappear" }, { value: "b", label: "Other" }];
    const single = render(<ChipGroup label="Trade" options={options} defaultValue="a" />);
    const multi = render(<ChipGroup label="Tags" name="tags" multiple options={options} defaultValue={["a", "b"]} />);
    expect(single.match(/type="radio"/g)).toHaveLength(2);
    expect(multi.match(/type="checkbox"/g)).toHaveLength(2);
    expect(multi.match(/checked=""/g)).toHaveLength(2);
    expect(multi).toContain(options[0].label);
  });

  it("time windows have unambiguous date-and-period names, values, disabled slots and a selection count", () => {
    const html = render(<TimeWindowPicker label="When?" name="windows" defaultValue={["tue-pm"]} days={[
      { value: "tue", label: "Tue 3 Nov", windows: [{ value: "tue-am", label: "Morning", disabled: true }, { value: "tue-pm", label: "Afternoon" }] },
    ]} />);
    expect(html).toContain('aria-label="Tue 3 Nov, Afternoon"');
    expect(html).toContain('value="tue-pm"');
    expect(html).toContain("1 time window selected");
    expect(html).toContain("Any time");
    expect(html).toMatch(/<input[^>]*disabled=""/);
  });

  it("an empty set of windows explains itself and has no misleading select-all action", () => {
    const html = render(<TimeWindowPicker label="When?" name="windows" days={[]} />);
    expect(html).toContain("No time windows are available yet.");
    expect(html).not.toContain("Any time");
  });
});

describe("address shell and validation example", () => {
  it("exposes a named collapsed combobox before focus and doesn't invent a chosen location", () => {
    const html = render(<AddressField label="Address" name="address" suggestions={[]} />);
    expect(tag(html)).toContain('role="combobox"');
    expect(tag(html)).toContain('aria-autocomplete="list"');
    expect(tag(html)).toContain('aria-expanded="false"');
    expect(html).not.toContain('role="option"');
  });

  it.each([
    ["loading", "Looking for addresses…"], ["ready", "No matches. You can type the address by hand."],
    ["error", "Address search is unavailable. You can type the address by hand."],
  ] as const)("announces the %s state without losing a typed address", (status, message) => {
    const html = render(<AddressField label="Address" name="address" defaultValue="12 Demo" suggestions={[]} status={status} />);
    expect(html).toContain('value="12 Demo"');
    expect(html).toContain(message);
    expect(html).toContain('role="status"');
  });

  it("returns field-specific errors without changing the submitted values", () => {
    const values = { name: "Wiremu", email: "bad-email", description: "Fix the fence", trade: "other", agreed: false };
    expect(validateExample(values)).toEqual({ email: "Add a valid email address.", agreed: "Confirm that you can provide access." });
    expect(values).toEqual({ name: "Wiremu", email: "bad-email", description: "Fix the fence", trade: "other", agreed: false });
  });

  it("accepts complete example values", () => {
    expect(validateExample({ name: "Wiremu", email: "wiremu@example.co.nz", description: "Fix the fence", trade: "other", agreed: true })).toEqual({});
  });
});

describe("development preview", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("is unavailable in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(FieldsPage({ searchParams: Promise.resolve({}) })).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });
  it("can show each state and palette, with the complete long-content and usage examples", async () => {
    vi.stubEnv("NODE_ENV", "development");
    for (const mode of ["customer", "trade", "office"]) {
      for (const state of ["default", "error", "disabled", "success"]) {
        const html = render(await FieldsPage({ searchParams: Promise.resolve({ mode, state }) }));
        expect(html).toContain(`data-mode="${mode}"`);
        for (const id of ["text", "choices", "booking", "address", "edge-cases", "usage"]) expect(html).toContain(`id="${id}"`);
      }
    }
  });
});
