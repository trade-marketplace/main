import { describe, expect, it } from "vitest";
import { calendarEvent } from "@/server/jobs/customer-calendar";

const job = {
  id: "00000000-0000-4000-8000-000000000524", jobNumber: 1005, title: "Replace switch", category: "ELECTRICAL" as const,
  addressLine1: "1 Main Street", addressLine2: null, suburb: "Windsor", city: "Invercargill", postcode: "9810",
  bookedDate: new Date("2026-11-23"), bookedTime: "MORNING" as const, updatedAt: new Date("2026-11-21T01:00:00Z"),
};

describe("booked job calendar", () => {
  it.each([
    ["2026-11-23", "MORNING", "20261122T190000Z", "20261122T230000Z"],
    ["2026-06-23", "AFTERNOON", "20260623T000000Z", "20260623T050000Z"],
    ["2026-11-23", "EVENING", "20261123T040000Z", "20261123T070000Z"],
    ["2026-09-27", "MORNING", "20260926T190000Z", "20260926T230000Z"],
    ["2026-04-05", "MORNING", "20260404T200000Z", "20260405T000000Z"],
  ] as const)("exports the %s %s Auckland booking as UTC", (day, period, start, end) => {
    const file = calendarEvent(job, new Date(day), period, 3);
    expect(file).toContain(`DTSTART:${start}\r\nDTEND:${end}\r\n`);
    expect(file).toContain(`UID:job-${job.id}@trademarketplace.nz\r\nSEQUENCE:3\r\n`);
    expect(file.replace(/\r\n /g, "")).toContain(`DESCRIPTION:TM-1005 · Electrical\\nhttps://trademarketplace.nz/jobs/${job.id}`);
  });
  it("escapes TEXT and folds long UTF-8 lines without splitting characters or leaking contact and price fields", () => {
    const privateJob = { ...job, title: "One, two; three\\four\r\nATTENDEE:someone",
      addressLine2: "Kāinga 🏡".repeat(24), priceCents: 910987, phone: "+64211234567", workerGrossCents: 762000 };
    const file = calendarEvent(privateJob, job.bookedDate, job.bookedTime, 0);
    expect(file).toContain("SUMMARY:Trade Marketplace: One\\, two\\; three\\\\four\\nATTENDEE:someone\r\n");
    const unfolded = file.replace(/\r\n /g, "");
    expect(unfolded).toContain("LOCATION:1 Main Street\\, " + privateJob.addressLine2 + "\\, Windsor\\, Invercargill\\, 9810");
    expect(file.split("\r\n").every(line => Buffer.byteLength(line) <= 75)).toBe(true);
    expect(file).not.toMatch(/910987|762000|\+64211234567|\r\nATTENDEE/);
    expect(file.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
});
