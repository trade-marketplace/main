import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { availableBookingWindows, bookingButtonLabel, type BookingSnapshot } from "@/lib/worker-booking";
import { BookWindow } from "@/components/jobs/worker/BookWindow";
vi.mock("next/navigation", () => ({ useSearchParams: () => null, useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/server/jobs/worker-booking-actions", () => ({ bookJobWindowAction: vi.fn(), requestOtherTimesAction: vi.fn() }));
const window = { date: "2026-11-12", timeOfDay: "MORNING" as const };
describe("worker booking", () => {
  it("hides past Auckland dates and preserves same-day day parts", () => {
    expect(availableBookingWindows([{ ...window, date: "2026-11-11" }, window], false, new Date("2026-11-12T00:00:00Z"))).toEqual([window]);
  });
  it("offers seven days of three day parts for Any time", () => {
    const windows = availableBookingWindows([], true, new Date("2026-11-12T00:00:00Z"));
    expect(windows).toHaveLength(21); expect(new Set(windows.map(item => item.date)).size).toBe(7);
    expect(windows.slice(0, 3).map(item => item.timeOfDay)).toEqual(["MORNING", "AFTERNOON", "EVENING"]);
  });
  it("names the picked window and distinguishes a change", () => {
    expect(bookingButtonLabel(window, false)).toBe("Book Thu 12 Nov · Morning");
    expect(bookingButtonLabel(window, true)).toBe("Change to Thu 12 Nov · Morning");
  });
  it("uses the customer name without inferred pronouns and exposes no phone or address", () => {
    const job = { id: "preview", title: "Sub wiring", suburb: "Windsor", customerFirstName: "Alex", windows: [window], booked: null, anyTime: false, revision: "1", customerPhone: "0211234567", address: "146 Private Street" };
    const html = renderToStaticMarkup(<BookWindow initial={job satisfies BookingSnapshot & { customerPhone: string; address: string }} />);
    expect(html).toContain("Sub wiring"); expect(html).toContain("and Alex’s told straight away"); expect(html).not.toMatch(/\bshe’s|\bher times/); expect(html).not.toMatch(/0211234567|146 Private Street|tel:/);
  });
});
