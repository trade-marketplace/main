import { describe, expect, it } from "vitest";

import { isForbidden, isSessionExpired, keptFormValues } from "@/lib/auth/results";

describe("keptFormValues", () => {
  it("keeps the text fields so the form can be filled in again", () => {
    const form = new FormData();
    form.set("title", "Hang a door");
    form.set("postcode", "9810");
    expect(keptFormValues(form)).toEqual({ title: "Hang a door", postcode: "9810" });
  });

  it("never keeps passwords, codes, files or Next.js's own fields", () => {
    const form = new FormData();
    form.set("password", "korimako-gumboot-41");
    form.set("newPassword", "x");
    form.set("code", "123456");
    form.set("photo", new Blob(["jpeg"]));
    form.set("$ACTION_ID_abc", "");
    form.set("notes", "Back door");
    expect(keptFormValues(form)).toEqual({ notes: "Back door" });
  });

  it("keeps every value of a repeated field", () => {
    const form = new FormData();
    form.append("trades", "ELECTRICAL");
    form.append("trades", "OTHER");
    expect(keptFormValues(form)).toEqual({ trades: "ELECTRICAL,OTHER" });
  });

  it("is empty without a form", () => {
    expect(keptFormValues(undefined)).toEqual({});
  });
});

describe("isSessionExpired / isForbidden", () => {
  it("recognise the guard's answers and nothing else", () => {
    expect(isSessionExpired({ ok: false, error: "session-expired", values: {} })).toBe(true);
    expect(isSessionExpired({ ok: false, error: "forbidden" })).toBe(false);
    expect(isSessionExpired(null)).toBe(false);
    expect(isForbidden({ ok: false, error: "forbidden" })).toBe(true);
    expect(isForbidden({ ok: true })).toBe(false);
  });
});
