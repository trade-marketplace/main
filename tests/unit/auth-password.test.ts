import { describe, expect, it } from "vitest";

import { COMMON_PASSWORDS } from "@/lib/auth/common-passwords";
import { PASSWORD_MIN_LENGTH, passwordMessage, passwordProblems } from "@/lib/auth/password";

describe("passwordProblems", () => {
  it("accepts a long, uncommon password", () => {
    expect(passwordProblems("korimako-gumboot-41", "sam@example.nz")).toEqual([]);
  });

  it("needs at least 10 characters", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(10);
    expect(passwordProblems("Kx9!mQ2#v")).toContain("too-short");
    expect(passwordProblems("Kx9!mQ2#vL")).not.toContain("too-short");
  });

  it("counts characters as people see them, not code units", () => {
    // Nine emoji are 18 UTF-16 code units but only nine characters.
    expect(passwordProblems("🦜🦜🦜🦜🦜🦜🦜🦜🦜")).toContain("too-short");
  });

  it("refuses passwords longer than Supabase can hash (72 bytes)", () => {
    expect(passwordProblems("x".repeat(72) + "y")).toContain("too-long");
    expect(passwordProblems("k".repeat(36) + "q".repeat(36))).not.toContain("too-long");
  });

  it("refuses every password on the bundled common list, in any case", () => {
    for (const common of COMMON_PASSWORDS) {
      expect(passwordProblems(common), common).toContain("common");
      expect(passwordProblems(common.toUpperCase()), common).toContain("common");
    }
  });

  it("only lists passwords that would otherwise pass the length rule", () => {
    for (const common of COMMON_PASSWORDS) expect([...common].length, common).toBeGreaterThanOrEqual(10);
  });

  it("sees through the usual tweaks to common passwords", () => {
    for (const tweaked of ["P@ssw0rd123", "Password2027!", "password!!!!", "Qwerty123456789", "letmein99999"]) {
      expect(passwordProblems(tweaked), tweaked).toContain("common");
    }
  });

  it("refuses repeats and straight runs", () => {
    for (const run of ["zzzzzzzzzzzz", "abcabcabcabc", "12121212121212", "0123456789", "9876543210", "klmnopqrst"]) {
      expect(passwordProblems(run), run).toContain("common");
    }
  });

  it("refuses the email address, or the part before the @", () => {
    expect(passwordProblems("sam.taylor@example.nz", "Sam.Taylor@example.nz")).toContain("looks-like-email");
    expect(passwordProblems("sam.taylor2026", "sam.taylor@example.nz")).toContain("looks-like-email");
  });
});

describe("passwordMessage", () => {
  it("gives one plain-English line for the first problem", () => {
    expect(passwordMessage("short")).toBe("Use at least 10 characters.");
    expect(passwordMessage("password123")).toMatch(/too easy to guess/);
  });

  it("is null for a good password", () => {
    expect(passwordMessage("korimako-gumboot-41")).toBeNull();
  });
});
