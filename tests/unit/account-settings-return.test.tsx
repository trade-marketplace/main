import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { AccountSettings } from "@/components/account/AccountSettings";
import { boardSettingsRoute } from "@/lib/job-board";
import TradesPage from "@/app/(app)/profile/trades/page";
import PayrollPage from "@/app/(app)/profile/payroll/page";
import NotificationsPage from "@/app/(app)/profile/notifications/page";
import WorkAreaPage from "@/app/(app)/profile/area/page";

const viewer = { userId: "tradie", role: "TRADIE", email: "tradie@example.test", firstName: "Jack", emailVerified: true };
vi.mock("@/server/auth/guard", () => ({ requireRole: vi.fn(async () => viewer), requireUser: vi.fn(async () => viewer) }));
vi.mock("@/server/db", () => ({ getDb: () => ({}) }));
vi.mock("@/server/account/trades", () => ({ loadTrades: vi.fn(async () => null) }));
vi.mock("@/server/account/payroll", () => ({ loadPayroll: vi.fn(async () => null) }));
vi.mock("@/server/workers/area", () => ({ loadWorkArea: vi.fn(async () => null) }));
vi.mock("@/server/notifications/preference-actions", () => ({ loadPreferencesAction: vi.fn(async () => null) }));
vi.mock("@/components/account/TradesLicences", () => ({ TradesLicences: () => null }));
vi.mock("@/components/account/PayrollSettings", () => ({ PayrollSettings: () => null, PayrollLoadError: () => null }));
vi.mock("@/components/account/NotificationPreferences", () => ({ NotificationPreferences: () => null }));
vi.mock("@/components/account/WorkArea", () => ({ WorkArea: () => null }));

describe("account settings board return", () => {
  const back = "/jobs?kind=bounty&distance=10";
  const destinations = ["/profile/area", "/profile/trades", "/profile/payroll", "/profile/notifications"];
  it("carries the canonical destination in both menus, only to the four consuming pages", () => {
    const html = renderToStaticMarkup(<AccountSettings role="TRADIE" next={back}>Content</AccountSettings>);
    for (const path of destinations) expect(html.split(`href="${boardSettingsRoute(path, back).href}"`)).toHaveLength(3);
    for (const path of ["/profile", "/profile/security", "/profile/delete"]) expect(html.split(`href="${path}"`)).toHaveLength(3);
  });
  it("drops external, protocol-relative, overlong and non-board addresses", () => {
    for (const next of [undefined, null, [back], "https://evil.test/jobs", "//evil.test/jobs", "/jobs/other", "/jobs?x=" + "a".repeat(4096), "/jobs\\evil.test", "/profile"]) {
      expect(boardSettingsRoute("/profile/area", next)).toEqual({ href: "/profile/area", back: null });
      expect(renderToStaticMarkup(<AccountSettings role="TRADIE" next={typeof next === "string" ? next : null}>Content</AccountSettings>)).not.toContain("?next=");
    }
  });
  it("keeps customer navigation unchanged even when supplied a board destination", () => {
    expect(renderToStaticMarkup(<AccountSettings role="CUSTOMER" next={back}>Content</AccountSettings>)).not.toContain("?next=");
  });
  for (const [name, Page] of [["Work area", WorkAreaPage], ["Trades", TradesPage], ["Payroll", PayrollPage], ["Notifications", NotificationsPage]] as const) {
    it(`${name} passes the validated return into its shared navigation`, async () => {
      const page = await Page({ searchParams: Promise.resolve({ next: back }) });
      expect(page.type).toBe(AccountSettings);
      expect(page.props.next).toBe(back);
      const plain = await Page({ searchParams: Promise.resolve({ next: "//evil.test/jobs" }) });
      expect(plain.props.next).toBeNull();
    });
  }
});
