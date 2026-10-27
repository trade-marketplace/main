// Shared sign-up field rules. Password rules stay in password.ts; no account data is stored in browser storage.
import { passwordMessage } from "./password";
import { safeNextPath } from "./routes";

/** A local NZ mobile or its international form, stored in the profile as E.164. */
export function normaliseMobile(value: string): string | null {
  const compact = value.replace(/[\s()-]/g, "");
  const local = compact.replace(/^(?:\+64|0064)/, "0");
  return /^02\d{7,9}$/.test(local) ? `+64${local.slice(1)}` : null;
}

export function passwordStrength(password: string, email = ""): { segments: number; hint: string } {
  if (!password) return { segments: 0, hint: "At least 10 characters. A few unrelated words work well." };
  const problem = passwordMessage(password, email);
  if (problem) return { segments: 1, hint: problem };
  if ([...password].length < 14) return { segments: 2, hint: "Good password. A few more words make it stronger." };
  return { segments: [...password].length >= 20 ? 4 : 3, hint: "Strong password." };
}

/** Keep the wizard's exact return path. Its sessionStorage draft is deliberately left untouched. */
export function signupLink(path: string, next?: string): string {
  const safe = safeNextPath(next);
  return `${path}${safe ? `?next=${encodeURIComponent(safe)}` : ""}`;
}
