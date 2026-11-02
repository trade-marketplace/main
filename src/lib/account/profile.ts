// Rules for the profile page (#112): what the form sends, what is checked, and how a saved profile is shown.
// Safe on server and browser. The same checks run in the browser (to say what is wrong before sending) and on the
// server (the only ones that count). The phone rule is the sign-up rule (normaliseMobile). The email is not here at
// all: changing it goes through Account > Security, so the new address is confirmed before it replaces the old one.
import { normaliseMobile } from "@/lib/auth/signup";

export type ProfileField = "name" | "phone";
export type ProfileFieldErrors = Partial<Record<ProfileField, string>>;

/** The raw form text. */
export type ProfileInput = { name: string; phone: string };

/** What gets stored: the sign-up shape (first name, the rest as last name, mobile as +64…). */
export type ProfileData = { firstName: string; lastName: string | null; phone: string };

/** The longest first name or last name, the same as sign-up. */
export const NAME_MAX = 80;

export const PROFILE_MESSAGES = {
  nameMissing: "Enter your name.",
  nameLong: "That name is too long.",
  phone: "Enter a New Zealand mobile number, like 021 555 0192.",
} as const;

export type ProfileResult =
  | { ok: true; name: string; phone: string }
  | { ok: false; error: "invalid"; fields: ProfileFieldErrors }
  | { ok: false; error: "unavailable" };

/** "Mary Anne  Smith" → first "Mary", last "Anne Smith". One word is a first name only. */
export function splitName(full: string): { firstName: string; lastName: string | null } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] ?? "", lastName: parts.length > 1 ? parts.slice(1).join(" ") : null };
}

export function joinName(firstName: string, lastName: string | null | undefined): string {
  return [firstName, lastName].filter(Boolean).join(" ");
}

/** +64215550192 → "021 555 0192". Anything else is shown as stored. */
export function formatMobile(e164: string | null | undefined): string {
  if (!e164) return "";
  const local = e164.startsWith("+64") ? `0${e164.slice(3)}` : e164;
  const match = /^(0\d{2})(\d{3})(\d{3,4})$/.exec(local);
  return match ? `${match[1]} ${match[2]} ${match[3]}` : local;
}

export function readProfileForm(form: FormData): ProfileInput {
  const text = (name: string) => {
    const value = form.get(name);
    return typeof value === "string" ? value : "";
  };
  // Nothing else is read: an email, id or role sent along with the form is ignored.
  return { name: text("name"), phone: text("phone") };
}

export function parseProfile(input: ProfileInput): { ok: true; data: ProfileData } | { ok: false; fields: ProfileFieldErrors } {
  const fields: ProfileFieldErrors = {};
  const { firstName, lastName } = splitName(input.name);
  if (!firstName) fields.name = PROFILE_MESSAGES.nameMissing;
  else if ([...firstName].length > NAME_MAX || [...(lastName ?? "")].length > NAME_MAX) fields.name = PROFILE_MESSAGES.nameLong;
  const phone = normaliseMobile(input.phone);
  if (!phone) fields.phone = PROFILE_MESSAGES.phone;
  if (Object.keys(fields).length || !phone) return { ok: false, fields };
  return { ok: true, data: { firstName, lastName, phone } };
}

/** Whether the form differs from what is saved (Save stays off until it does). Extra spaces don't count. */
export function profileChanged(saved: ProfileInput, current: ProfileInput): boolean {
  const squash = (value: string) => value.trim().replace(/\s+/g, " ");
  const phone = (value: string) => normaliseMobile(value) ?? squash(value);
  return squash(saved.name) !== squash(current.name) || phone(saved.phone) !== phone(current.phone);
}

/** Avatar uploads are shrunk in the browser to fit in this many pixels, so they stay small on the wire. */
export const AVATAR_EDGE = 512;
