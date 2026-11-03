import { describe, expect, it } from "vitest";
import { currentSchedule, postingDateRange, postingDays, selectedTimeWindows, timeWindowsExpired, timeWindowsInRange } from "@/lib/job-time-windows";
import { canonicalDraft, decodeWizardDraft, editWhere, encodeWizardDraft, initialWizardDraft, whereErrors, whereInputs } from "@/lib/post-job-wizard";
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
