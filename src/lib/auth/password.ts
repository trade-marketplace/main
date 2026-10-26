// Password rules for sign-up (#101). Safe on server and browser, so the sign-up pages (#104, #105) can show the
// same hint before submitting. The server action always checks again: the browser's check is only a courtesy.
// Supabase Auth hashes and stores the password; it's also set to a 10-character minimum in the project settings.

import { COMMON_PASSWORDS } from "./common-passwords";

export const PASSWORD_MIN_LENGTH = 10;
// Supabase Auth hashes with bcrypt, which only reads the first 72 bytes, so longer passwords are refused rather
// than silently cut short.
export const PASSWORD_MAX_BYTES = 72;

export type PasswordProblem = "too-short" | "too-long" | "common" | "looks-like-email";

export const PASSWORD_MESSAGES: Readonly<Record<PasswordProblem, string>> = {
  "too-short": `Use at least ${PASSWORD_MIN_LENGTH} characters.`,
  "too-long": "That's too long. Use a shorter password.",
  common: "That password is too easy to guess. Try a few unrelated words together.",
  "looks-like-email": "Don't use your email address as your password.",
};

/** Characters a person typed, not UTF-16 units: an emoji counts as one. */
function characterCount(value: string): number {
  return [...value].length;
}

/** Lowercase, with the usual "make it stronger" tweaks undone: `P@ssw0rd123!` → `password123`. */
function guessable(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[!?.]+$/, "")
    .replace(/@/g, "a")
    .replace(/0/g, "o")
    .replace(/\$/g, "s");
}

function isRepeat(value: string): boolean {
  // One short chunk over and over: "aaaaaaaaaa", "abcabcabcabc", "12121212121".
  return /^(.{1,3})\1+$/u.test(value);
}

function isRun(value: string): boolean {
  // Straight runs up or down the keyboard's digits or the alphabet: "0123456789", "abcdefghij", "9876543210".
  const codes = [...value.toLowerCase()].map((c) => c.codePointAt(0) ?? 0);
  if (codes.length < 2) return false;
  const step = codes[1] - codes[0];
  if (Math.abs(step) !== 1) return false;
  return codes.every((code, i) => i === 0 || code - codes[i - 1] === step);
}

function isCommon(password: string): boolean {
  const lower = password.toLowerCase().normalize("NFKC");
  if (COMMON_PASSWORDS.has(lower)) return true;
  const plain = guessable(password);
  if (COMMON_PASSWORDS.has(plain)) return true;
  if (isRepeat(lower) || isRun(lower)) return true;
  // A common word with only digits or symbols stuck on the end: "password2027", "P@ssw0rd2027!", "letmein99999".
  // Strip the ending first, then undo the tweaks, so the digits of a year aren't read as letters.
  const stem = guessable(lower.replace(/[\d\W_]+$/u, ""));
  const words = ["password", "passw", "qwerty", "letmein", "welcome", "iloveyou", "admin", "trademarketplace"];
  return stem.length > 0 && words.some((word) => stem === word);
}

/**
 * Every rule the password breaks, in the order to show them. Empty means it's fine.
 * Pass the email so a password that is just the email (or the part before the @) is caught.
 */
export function passwordProblems(password: string, email?: string | null): PasswordProblem[] {
  const problems: PasswordProblem[] = [];
  if (characterCount(password) < PASSWORD_MIN_LENGTH) problems.push("too-short");
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) problems.push("too-long");
  if (isCommon(password)) problems.push("common");

  const normalisedEmail = email?.trim().toLowerCase();
  if (normalisedEmail) {
    const lower = password.trim().toLowerCase();
    const localPart = normalisedEmail.split("@")[0];
    if (lower === normalisedEmail || (localPart.length >= 4 && lower.replace(/\d+$/, "") === localPart)) {
      problems.push("looks-like-email");
    }
  }
  return problems;
}

/** The first problem's message, for a single line under the password field; null when the password is fine. */
export function passwordMessage(password: string, email?: string | null): string | null {
  const [first] = passwordProblems(password, email);
  return first ? PASSWORD_MESSAGES[first] : null;
}
