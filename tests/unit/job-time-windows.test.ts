import { describe, expect, it } from "vitest";
import { currentSchedule, postingDateRange, postingDays, selectedTimeWindows, timeWindowsExpired, timeWindowsInRange } from "@/lib/job-time-windows";
import { canClearStaleDescribe, canonicalDraft, decodeWizardDraft, editWhere, encodeWizardDraft, inheritUneditedWhere, initialWizardDraft, localEnvelopeMatchesInput, recoverServerWizard, serverRepresentsWhere, whereErrors, whereInputs } from "@/lib/post-job-wizard";
import { jobScheduleSchema } from "@/lib/job-draft";

const now = new Date("2026-11-03T10:59:59Z");
describe("Auckland date-only windows", () => {
  it("rolls the complete seven-day grid only at Auckland midnight", () => {
    expect(postingDateRange(now)).toEqual({ today: "2026-11-03", last: "2026-11-09" });
    const next = new Date("2026-11-03T11:00:00Z");
    expect(postingDateRange(next)).toEqual({ today: "2026-11-04", last: "2026-11-10" });
    expect(postingDays(next)).toHaveLength(7);
    expect(postingDays(next)[0].windows).toHaveLength(3);
  });
  it("handles NZ standard time without shortening calendar days", () => {
    expect(postingDateRange(new Date("2026-07-01T11:59:59Z")).today).toBe("2026-07-01");
    expect(postingDateRange(new Date("2026-07-01T12:00:00Z")).today).toBe("2026-07-02");
  });
  it("keeps all same-day parts valid through the end of the day", () => {
    for (const timeOfDay of ["MORNING", "AFTERNOON", "EVENING"] as const) {
      const windows = [{ date: "2026-11-03", timeOfDay }];
      expect(timeWindowsInRange(windows, now)).toBe(true);
      expect(timeWindowsExpired(windows, false, now)).toBe(false);
      expect(timeWindowsExpired(windows, false, new Date("2026-11-03T11:00:00Z"))).toBe(true);
    }
  });
  it("requires every dated selection to expire and preserves Any time and legacy empty selections", () => {
    expect(timeWindowsExpired([{ date: "2026-11-02" }, { date: "2026-11-03" }], false, now)).toBe(false);
    expect(timeWindowsExpired([{ date: "2026-11-02" }], true, now)).toBe(false);
    expect(timeWindowsExpired([], false, now)).toBe(false);
  });
  it("accepts only offered keys, preserves day order and deduplicates", () => {
    expect(selectedTimeWindows(["2026-11-04/EVENING", "2026-11-03/MORNING", "bad", "2026-11-03/MORNING"], now)).toEqual([{ date: "2026-11-03", timeOfDay: "MORNING" }, { date: "2026-11-04", timeOfDay: "EVENING" }]);
  });
  it("fills 21 current windows for explicit Any time while preserving ASAP", () => {
    const schedule = currentSchedule({ anyTime: true, asap: true, timeWindows: [{ date: "2020-01-01", timeOfDay: "MORNING" }] }, now);
    expect(schedule.timeWindows).toHaveLength(21); expect(schedule.asap).toBe(true);
    expect(timeWindowsInRange(schedule.timeWindows, now)).toBe(true);
  });
  it("shares required-selection and duplicate validation with posting", () => {
    expect(jobScheduleSchema.safeParse({}).success).toBe(false);
    expect(jobScheduleSchema.safeParse({ anyTime: true }).success).toBe(true);
    const window = { date: "2026-11-03", timeOfDay: "MORNING" };
    expect(jobScheduleSchema.safeParse({ timeWindows: [window, window] }).success).toBe(false);
    expect(jobScheduleSchema.safeParse({ anyTime: true, priceCents: 1 }).success).toBe(false);
  });
});
describe("Where draft restoration", () => {
  const initial = () => initialWizardDraft({ description: "Lights keep flickering", category: "ELECTRICAL", photoPaths: [], locationSource: "TYPED", addressLine1: "1 Example St", suburb: "Gladstone", city: "Invercargill", timeWindows: [{ date: "2026-11-03", timeOfDay: "MORNING" }] }, true);
  it("retains unfinished postcode and optional notes locally without sending invalid canonical fields", () => {
    const draft = editWhere(initial(), { postcode: "98", accessNotes: "Use the side gate", addressLine2: "2" });
    const decoded = decodeWizardDraft(encodeWizardDraft(draft, "owner"), "owner")!;
    expect(whereInputs(decoded).postcode).toBe("98"); expect(canonicalDraft(decoded).postcode).toBeUndefined();
    expect(canonicalDraft(decoded).accessNotes).toBe("Use the side gate"); expect(whereErrors(decoded, now)).toEqual({ postcode: "Address" });
    expect(decodeWizardDraft(encodeWizardDraft(draft, "owner"), "another")).toBeNull();
  });
  it("keeps stale raw selections visible for correction rather than silently deleting them", () => {
    const draft = initial(); const nextDay = new Date("2026-11-03T11:00:00Z");
    expect(whereErrors(draft, nextDay)).toEqual({ timeWindows: "When do you need it?" });
    expect(draft.data.timeWindows).toEqual([{ date: "2026-11-03", timeOfDay: "MORNING" }]);
    expect(whereErrors({ ...draft, data: { ...draft.data, anyTime: true } }, nextDay)).toEqual({});
  });
  it("bounds editable strings and retains a new server draft's later-step fields", () => {
    expect(whereInputs(editWhere(initial(), { addressLine1: "x".repeat(500) })).addressLine1).toHaveLength(200);
    expect(initial().completedPhotos).toBe(true);
  });
});

describe("owned server recovery after failed device writes", () => {
  const key = "9b58063b-12c2-4b46-9c45-38353f41173e";
  const server = { postKey: key, description: "Lights keep flickering", category: "ELECTRICAL" as const, photoPaths: [], locationSource: "TYPED" as const, addressLine1: "1 Example St", suburb: "Gladstone", city: "Invercargill", postcode: "9810", anyTime: true, asap: false, timeWindows: [] };
  const old = () => editWhere(initialWizardDraft(server, true, false), { postcode: "98" });
  it("selects the confirmed corrected postcode rather than a stale partial cache", () => {
    const restored = recoverServerWizard(old(), server, false, true, now)!;
    expect(whereInputs(restored).postcode).toBe("9810"); expect(restored.completedWhere).toBe(true);
    expect(localEnvelopeMatchesInput(restored, old())).toBe(false);
    // The owned savedWhere URL context remains true after Review → Back → Where.
    expect(whereInputs(recoverServerWizard(old(), server, false, true, now)!).postcode).toBe("9810");
  });
  it("uses an intentionally cleared optional postcode after confirmed Where, including Back and refresh", () => {
    const cleared = { ...server, postcode: undefined };
    expect(whereInputs(recoverServerWizard(old(), cleared, false, true, now)!).postcode).toBe("");
    expect(recoverServerWizard(old(), cleared, false, true, now)?.completedWhere).toBe(true);
  });
  it("preserves genuinely unfinished raw text after Describe or Photos Next without claiming server durability", () => {
    const withoutPartial = { ...server, postcode: undefined };
    const restored = recoverServerWizard(old(), withoutPartial, false, false, now)!;
    expect(whereInputs(restored).postcode).toBe("98"); expect(restored.completedWhere).toBe(false);
    expect(serverRepresentsWhere(restored)).toBe(false); expect(whereErrors(restored, now)).toEqual({ postcode: "Address" });
    expect(canClearStaleDescribe(initialWizardDraft(server), old())).toBe(false);
    expect(canClearStaleDescribe(old(), initialWizardDraft({ postKey: key }))).toBe(false);
  });
  it("inherits unvisited server address and schedule fields, but preserves a device's edited raw Where", () => {
    const unvisited = initialWizardDraft({ postKey: key, description: server.description, category: server.category });
    expect(inheritUneditedWhere(unvisited, server, true)?.data).toMatchObject({ addressLine1: server.addressLine1, postcode: server.postcode, locationSource: server.locationSource, anyTime: true, timeWindows: [] });
    expect(inheritUneditedWhere(old(), server, true)).toEqual(old());
    expect(inheritUneditedWhere(unvisited, { ...server, postKey: "another-key" }, true)).toBe(unvisited);
    expect(inheritUneditedWhere(unvisited, server, false)).toBe(unvisited);
  });
  it("does not equate incomplete raw input or stale address/schedule state with a durable server snapshot", () => {
    const current = editWhere(initialWizardDraft(server, true), { postcode: "9810" });
    expect(serverRepresentsWhere(current)).toBe(true); expect(serverRepresentsWhere(old())).toBe(false);
    expect(localEnvelopeMatchesInput(current, current)).toBe(true);
    expect(localEnvelopeMatchesInput(current, old())).toBe(false);
    expect(localEnvelopeMatchesInput(current, { ...current, data: { ...current.data, asap: true } })).toBe(false);
    expect(localEnvelopeMatchesInput(current, { ...current, data: { ...current.data, point: { lat: -46.4, lng: 168.3 } } })).toBe(false);
  });
});
