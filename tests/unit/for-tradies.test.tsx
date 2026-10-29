import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ForTradiesPage } from "@/components/site/ForTradiesPage";
import { headerActions } from "@/components/site/site-links";
import { SIGNUP_TRADES } from "@/lib/auth/worker-signup";
import { loadTradieData, tradieEarnings } from "@/server/for-tradies";
import { perHour, priceWork, ratesForTrade } from "@/server/pricing/calculate";

const settings = { sharedRateCents: 7350, otherRateCents: 4100, sharedMinMinutes: 120, otherMinMinutes: 60, holidayPayBps: 800, onCostBps: 1250, marginBps: 2000, gstBps: 1500 };

describe("For tradies", () => {
  it("uses the current server pricing helpers and only returns worker pay", () => {
    const data = tradieEarnings(settings);
    expect(data.status).toBe("ready");
    if (data.status !== "ready") throw new Error("Expected earnings");
    for (const item of data.earnings) {
      const rates = ratesForTrade(item.trade, settings);
      expect(item.hourlyCents).toBe(perHour(rates).workerEarnsCents);
      expect(item.exampleCents).toBe(priceWork({ minutes: item.minutes, materialsCents: 0 }, rates).workerEarnsCents);
    }
    expect(JSON.stringify(data)).not.toMatch(/customerPrice|margin|gst/i);
    expect(tradieEarnings({ ...settings, sharedRateCents: 9000 })).not.toEqual(data);
  });

  it("reads only rate settings, with no invented fallback for missing settings", async () => {
    const findUnique = vi.fn().mockResolvedValue(settings);
    const db = { settings: { findUnique } } as unknown as NonNullable<Parameters<typeof loadTradieData>[0]>;
    expect(await loadTradieData(db)).toEqual(tradieEarnings(settings));
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 1 }, select: expect.any(Object) }));
    findUnique.mockResolvedValue(null);
    expect(await loadTradieData(db)).toEqual({ status: "empty" });
    expect(await loadTradieData(null)).toEqual({ status: "empty" });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    findUnique.mockRejectedValue(new Error("private database error"));
    expect(await loadTradieData(db)).toEqual({ status: "error" });
    expect(log).not.toHaveBeenCalledWith(expect.stringContaining("private"));
    log.mockRestore();
  });

  it("keeps the founder hero, all configured trade requirements and signup destination", () => {
    const html = renderToString(<ForTradiesPage data={tradieEarnings(settings)} />);
    expect(html).toContain("You do the work.");
    expect(html).toContain("We find the jobs.");
    expect(html).not.toMatch(/we do the paperwork|testimonials|Sarah|259\.20|96\.00/i);
    for (const trade of SIGNUP_TRADES) expect(html).toContain(trade.licence?.label ?? "photo ID");
    expect(html).toContain('href="/signup/tradie"');
    expect(html).toContain("Invercargill");
    expect(html).toContain("any job");
  });

  it.each(["empty", "error", "loading"] as const)("never invents figures in the %s state", (status) => {
    const html = renderToString(<ForTradiesPage data={{ status }} />);
    expect(html).not.toContain("$");
    expect(html).toContain(status === "loading" ? 'aria-busy="true"' : "Rates unavailable");
  });

  it("offers tradie signup on this route and preserves other public and signed-in actions", () => {
    expect(headerActions(null, "/for-tradies")).toMatchObject({ postJob: null, guest: { signUp: { label: "Join as a tradie", href: "/signup/tradie" } } });
    expect(headerActions(null, "/")).toEqual(headerActions(null));
    expect(headerActions(null, "/how-it-works")).toEqual(headerActions(null));
    for (const role of ["CUSTOMER", "TRADIE", "ADMIN"] as const) expect(headerActions({ firstName: "Sam", role }, "/for-tradies")).toEqual(headerActions({ firstName: "Sam", role }));
  });
});
