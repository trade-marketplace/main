import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SetupBanner, TradieSetupHome } from "@/components/jobs/TradieSetup";
import { boardSettingsRoute, DEFAULT_BOARD_QUERY, parseBoardQuery } from "@/lib/job-board";
import { BROWSE_JOBS_HREF, buildTradieSetup, setupBannerLabel, showsSetupHome, type SetupFacts } from "@/lib/tradie-setup";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const NOW = new Date("2026-11-10T00:00:00Z");
// The mockup (w-t-onboard): email and trades done, licence with the office, work area set, bank and photo to do.
const mockup: SetupFacts = { emailVerified: true, tradeLabels: ["Electrical", "Gas fitting"], licence: "checking", bankComplete: false, hasPhoto: false, hasWorkArea: true, canBrowse: true };
const build = (facts: Partial<SetupFacts> = {}) => buildTradieSetup({ ...mockup, ...facts }, NOW);
const step = (setup: ReturnType<typeof build>, id: string) => setup.steps.find(item => item.id === id);
const text = (html: string) => html.replace(/<!-- -->/g, "");

describe("tradie setup checklist steps", () => {
  it("lists the mockup's six steps in order with its progress and wording", () => {
    const setup = build();
    expect(setup.steps.map(item => [item.id, item.state])).toEqual([["email", "done"], ["trades", "done"], ["licence", "checking"], ["bank", "todo"], ["photo", "todo"], ["area", "done"]]);
    expect(setup).toMatchObject({ done: 3, total: 6, complete: false, licenceChecking: true });
    expect(step(setup, "trades")?.caption).toBe("Electrical, Gas fitting");
    expect(step(setup, "licence")).toMatchObject({ title: "Licence check", caption: "Usually 1 working day. We’ll email you.", action: null });
    expect(setupBannerLabel(setup)).toBe("Finish setup (3/6)");
  });
  it("sends each open step to its settings page with the way back to /jobs", () => {
    const setup = build({ emailVerified: false, tradeLabels: [], licence: "rejected", hasWorkArea: false });
    expect(Object.fromEntries(setup.steps.map(item => [item.id, item.action]))).toEqual({
      email: { label: "Send the link again", href: "/verify?next=%2Fjobs" }, trades: { label: "Add", href: "/profile/trades?next=%2Fjobs" },
      licence: { label: "Try again", href: "/profile/trades?next=%2Fjobs" }, bank: { label: "Add", href: "/profile/payroll?next=%2Fjobs" },
      photo: { label: "Upload", href: "/profile?next=%2Fjobs" }, area: { label: "Add", href: "/profile/area?next=%2Fjobs" } });
    expect(setup.done).toBe(0);
  });
  it("what if they only do Other work? there is no licence step and the count is out of five", () => {
    const setup = build({ tradeLabels: ["Other / general labour"], licence: "none" });
    expect(setup.steps.map(item => item.id)).toEqual(["email", "trades", "bank", "photo", "area"]);
    expect(setup).toMatchObject({ done: 3, total: 5, licenceChecking: false });
  });
  it("hands a rejected or expired licence back to the tradie, and never counts a licence being checked as done", () => {
    expect(step(build({ licence: "rejected" }), "licence")).toMatchObject({ state: "todo", problem: "Rejected", action: { label: "Try again" } });
    expect(step(build({ licence: "expired" }), "licence")).toMatchObject({ state: "todo", problem: "Expired", action: { label: "Update" } });
    expect(build({ bankComplete: true, hasPhoto: true }).complete).toBe(false);
    expect(build({ licence: "done", bankComplete: true, hasPhoto: true })).toMatchObject({ done: 6, total: 6, complete: true });
  });
});

describe("where /jobs goes", () => {
  it("shows the checklist on plain /jobs until setup is complete, then the board", () => {
    expect(showsSetupHome(build(), DEFAULT_BOARD_QUERY)).toBe(true);
    expect(showsSetupHome(build(), parseBoardQuery(new URLSearchParams("utm=email")))).toBe(true);
    expect(showsSetupHome(build({ licence: "done", bankComplete: true, hasPhoto: true }), DEFAULT_BOARD_QUERY)).toBe(false);
  });
  it("keeps Browse jobs, filters and the map on the board before setup is complete", () => {
    for (const search of [new URL(BROWSE_JOBS_HREF, "https://board.test").search, "?kind=ready", "?view=map", "?trade=other"]) expect(showsSetupHome(build(), parseBoardQuery(new URLSearchParams(search)))).toBe(false);
  });
  it("carries the way back through every settings page and never leaves the board", () => {
    for (const path of ["/profile", "/profile/trades", "/profile/payroll"]) {
      expect(boardSettingsRoute(path, "/jobs")).toEqual({ href: `${path}?next=%2Fjobs`, back: "/jobs" });
      expect(boardSettingsRoute(path, "//evil.test/jobs")).toEqual({ href: path, back: null });
      expect(boardSettingsRoute(path, undefined)).toEqual({ href: path, back: null });
    }
  });
});

describe("tradie setup screen", () => {
  const render = (facts: Partial<SetupFacts> = {}) => text(renderToString(<TradieSetupHome firstName="Jack" result={{ ok: true, setup: build(facts) }} />));
  it("draws the mockup: greeting, progress, struck-through done steps, the Checking pill and both side cards", () => {
    const html = render();
    expect(html).toMatch(/<h1[^>]*>Welcome, Jack\. Let’s get you working\.<\/h1>/);
    expect(html).toContain("Finish these and you can claim jobs. You can browse while we check your licence.");
    expect(html).toMatch(/role="progressbar"[^>]*aria-valuemax="6"[^>]*aria-valuenow="3"[^>]*aria-valuetext="3 of 6 done"/);
    expect(html).toContain("<s>Verify your email</s>");
    expect(html).not.toContain("<s>Licence check</s>");
    expect(html).toContain("Checking");
    expect(html).toContain("While you wait");
    expect(html).toContain(`href="${BROWSE_JOBS_HREF}"`);
    for (const line of ["Estimate jobs (private)", "Claim priced jobs: first in", "Do the work, upload evidence", "Get paid next payroll"]) expect(html).toContain(line);
  });
  it("gives each action its own accessible name", () => {
    const html = render();
    expect(html).toMatch(/href="\/profile\/payroll\?next=%2Fjobs"[^>]*>.*?Add<span[^>]*>\(Add bank account &amp; IRD number\)<\/span>/);
    expect(html).toMatch(/href="\/profile\?next=%2Fjobs"[^>]*>.*?Upload<span[^>]*>\(Add a profile photo\)<\/span>/);
  });
  it("stays honest when the board can't show jobs yet: no browse promise and no While you wait card", () => {
    const html = render({ canBrowse: false });
    expect(html).toContain("Finish these and you can claim jobs.");
    expect(html).not.toContain("You can browse while we check your licence.");
    expect(html).not.toContain("While you wait");
    expect(html).toContain("How it works");
  });
  it("does not mention a licence to Other-only tradies", () => {
    const html = render({ tradeLabels: ["Other / general labour"], licence: "none" });
    expect(html).not.toContain("Licence check");
    expect(html).not.toContain("check your licence");
    expect(html).toContain("3 of 5");
  });
  it("shows a retry, not a finished checklist, when the steps can't be read", () => {
    const html = text(renderToString(<TradieSetupHome firstName="Jack" result={{ ok: false }} />));
    expect(html).toContain("Can’t load your setup");
    expect(html).toContain("Try again");
    expect(html).not.toContain("role=\"progressbar\"");
    expect(html).not.toContain("While you wait");
  });
  it("holds skeleton rows while it loads", () => {
    const html = text(renderToString(<TradieSetupHome firstName="Jack" result={{ ok: true, setup: build() }} preview={{ loading: true }} />));
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain("Licence check");
  });
  it("links the board's slim banner back to the checklist with the live count", () => {
    const html = text(renderToString(<SetupBanner setup={build()} />));
    expect(html).toMatch(/href="\/jobs"[^>]*>Finish setup \(3\/6\)<\/a>/);
  });
});
