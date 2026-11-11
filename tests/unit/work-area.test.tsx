import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { WorkArea } from "@/components/account/WorkArea";
import { WorkerSignupFields } from "@/components/auth/WorkerSignupFields";
import { parseWorkArea, workAreaChanged, type WorkAreaSnapshot } from "@/lib/account/work-area";
import { boardSettingsRoute } from "@/lib/job-board";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const initial: WorkAreaSnapshot = { baseSuburb: "Invercargill", radiusKm: 25, point: { lat: -46.4132, lng: 168.3538 }, available: true, paused: false, trades: ["OTHER"] };
describe("work area", () => {
  it("leaves Save off until the suburb, selected point or radius changes", () => {
    expect(workAreaChanged(initial, { ...initial, radiusKm: "25" })).toBe(false);
    for (const change of [{ baseSuburb: "Windsor" }, { radiusKm: 10 }, { point: null }, { point: { lat: -46, lng: 168 } }]) expect(workAreaChanged(initial, { ...initial, ...change })).toBe(true);
    expect(renderToStaticMarkup(<WorkArea initial={initial} />)).toMatch(/<button[^>]*aria-disabled="true"[^>]*>[\s\S]*?Save changes/);
    expect(renderToStaticMarkup(<WorkArea initial={initial} preview="changed" />)).not.toMatch(/<button[^>]*aria-disabled="true"[^>]*>[\s\S]*?Save changes/);
  });
  it("requires a selected point and keeps the shared suburb/radius validation", () => {
    expect(parseWorkArea({ ...initial, point: null })).toEqual({ ok: false, fields: { baseSuburb: "Choose a suburb from the search results." } });
    expect(parseWorkArea({ ...initial, radiusKm: 30 })).toEqual({ ok: false, fields: { radiusKm: "Choose 10, 25 or 50 km." } });
    expect(parseWorkArea({ ...initial, point: { lat: NaN, lng: 168 } }).ok).toBe(false);
    expect(parseWorkArea({ ...initial, baseSuburb: "  Windsor  " })).toMatchObject({ ok: true, data: { baseSuburb: "Windsor" } });
  });
  it("only supplies Back to jobs for a bounded board return destination", () => {
    expect(boardSettingsRoute("/profile/area", "/jobs?view=all&sort=earn")).toEqual({ href: "/profile/area?next=%2Fjobs%3Fsort%3Dearn%26view%3Dall", back: "/jobs?sort=earn&view=all" });
    for (const next of [undefined, "https://evil.test/jobs", "//evil.test/jobs", "/profile", ["/jobs"]]) expect(boardSettingsRoute("/profile/area", next).back).toBeNull();
  });
  it("shows a plain map fallback, read-only trades and existing alert settings", () => {
    const html = renderToStaticMarkup(<WorkArea initial={initial} />);
    expect(html).toContain("Invercargill · 25 km"); expect(html).toContain('href="/profile/trades"'); expect(html).toContain('href="/profile/notifications"');
    expect(html).not.toContain("mapbox://");
  });
  it("lets a paused tradie read but disables both writes", () => {
    const html = renderToStaticMarkup(<WorkArea initial={{ ...initial, paused: true }} preview="changed" />);
    expect(html).toContain("Your account is paused."); expect(html).toMatch(/role="switch"[^>]*disabled|disabled[^>]*role="switch"/);
  });
  it("keeps sign-up manual entry while work area exposes an honest retry-only lookup", () => {
    const signup = renderToStaticMarkup(<WorkerSignupFields attempt={0} previewAreaState="unavailable" />);
    expect(signup).toContain("Type your suburb or town by hand.");
    const area = renderToStaticMarkup(<WorkArea initial={initial} preview="search-unavailable" />);
    expect(area).toContain("Try again to choose a suburb."); expect(area).not.toContain("Type your suburb or town by hand.");
  });
  it("disables enabling alerts until the area is saved, but keeps turning them off available", () => {
    const incomplete = { ...initial, point: null, available: false };
    const off = renderToStaticMarkup(<WorkArea initial={incomplete} />);
    expect(off).toContain("Save your work area before turning on job alerts."); expect(off).toMatch(/role="switch"[^>]*disabled|disabled[^>]*role="switch"/);
    const on = renderToStaticMarkup(<WorkArea initial={{ ...incomplete, available: true }} />);
    expect(on).not.toMatch(/role="switch"[^>]*disabled|disabled[^>]*role="switch"/);
  });
  it("carries the safe board destination into Trades and Notifications", () => {
    const html = renderToStaticMarkup(<WorkArea initial={initial} next="/jobs?trade=electrical&distance=10" />);
    expect(html).toContain('href="/profile/trades?next=%2Fjobs%3Ftrade%3Delectrical%26distance%3D10"');
    expect(html).toContain('href="/profile/notifications?next=%2Fjobs%3Ftrade%3Delectrical%26distance%3D10"');
  });
});
