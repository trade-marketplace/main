import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { licenceState, licenceToday, parseTradeInput, type TradeRow, type TradeSnapshot } from "@/lib/account/trades";
import { parseLicenceNumber, parseWorkerSignup } from "@/lib/auth/worker-signup";
import { TradesLicences } from "@/components/account/TradesLicences";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
const today = "2026-11-04";
const row = (change: Partial<NonNullable<TradeRow["licence"]>> = {}): TradeRow => ({ trade: "ELECTRICAL", licence: { id: "licence-1", number: "E 123456", status: "VERIFIED", expiresOn: "2027-03-31", rejectionReason: null, hasDocument: true, ...change } });

describe("trade details and licence status", () => {
  it("uses the signup number formats and tidies the same way in both forms", () => {
    expect(parseLicenceNumber("ELECTRICAL", " e 123456 ")).toEqual({ ok: true, number: "E 123456" });
    expect(parseLicenceNumber("PLUMBING", "nonsense").ok).toBe(false);
    const signup = parseWorkerSignup({ trades: ["ELECTRICAL"], licences: { ELECTRICAL: "e 123456" }, baseSuburb: "Windsor", radiusKm: 25, point: null });
    expect(signup).toMatchObject({ ok: true, details: { licences: { ELECTRICAL: "E 123456" } } });
  });
  it("asks restricted trades for a current licence number and expiry, and Other for neither", () => {
    expect(parseTradeInput({ trade: "OTHER", number: "", expiresOn: "" }, today)).toEqual({ ok: true, data: { trade: "OTHER", number: "", expiresOn: null } });
    expect(parseTradeInput({ trade: "ELECTRICAL", number: "E 123456", expiresOn: "2026-11-04" }, today).ok).toBe(true);
    expect(parseTradeInput({ trade: "ELECTRICAL", number: "x", expiresOn: "2026-11-03" }, today)).toMatchObject({ ok: false, fields: { number: expect.any(String), expiresOn: expect.any(String) } });
    expect(parseTradeInput({ trade: "PLUMBING", number: "PGDB 98211", expiresOn: "2027-02-30" }, today).ok).toBe(false);
    expect(parseTradeInput({ trade: "OTHER;DROP", number: "", expiresOn: "" }, today).ok).toBe(false);
  });
  it("distinguishes checking, rejected, checked, expiring and expired without hiding Other", () => {
    expect(licenceState(row(), today)).toBe("checked");
    expect(licenceState(row({ status: "PENDING" }), today)).toBe("checking");
    expect(licenceState(row({ status: "REJECTED", rejectionReason: "Unreadable" }), today)).toBe("rejected");
    expect(licenceState(row({ expiresOn: "2026-12-04" }), today)).toBe("expiring");
    expect(licenceState(row({ expiresOn: "2026-12-05" }), today)).toBe("checked");
    expect(licenceState(row({ expiresOn: "2026-11-03" }), today)).toBe("expired");
    expect(licenceState({ trade: "OTHER", licence: null }, today)).toBe("none");
    expect(licenceToday(new Date("2026-11-03T11:05:00Z"))).toBe("2026-11-04");
  });
  it("renders the reason, retry and expiry warning using the shared account components", () => {
    const snapshot: TradeSnapshot = { today, rows: [row({ status: "REJECTED", rejectionReason: "Licence photo was unreadable" }), { trade: "OTHER", licence: null }] };
    const html = renderToStaticMarkup(<TradesLicences initial={snapshot} />);
    expect(html).toContain("Licence photo was unreadable"); expect(html).toContain("Try again"); expect(html).toContain("No licence needed");
    const expired = renderToStaticMarkup(<TradesLicences initial={{ today, rows: [row({ expiresOn: "2026-11-03" })] }} />);
    expect(expired).toContain("Expired"); expect(expired).toContain("before claiming jobs in this trade");
  });
});
