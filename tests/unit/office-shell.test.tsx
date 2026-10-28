import { readFileSync } from "node:fs";

import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import OfficeLayout, { viewport as officeViewport } from "@/app/admin/layout";
import { OfficeShell } from "@/components/office/OfficeShell";
import { OfficeShellView, type OfficeShellViewer } from "@/components/office/OfficeShellView";
import { currentOfficeLink, officeCountLabel, officeHref, OFFICE_NAV, type OfficeCounts } from "@/components/office/office-links";
import { requireRole } from "@/server/auth/guard";
import { getOfficeShellViewer } from "@/server/office-shell";

// Rendering the form must never perform a real sign-out.
vi.mock("@/server/auth/actions", () => ({ logInAgainAction: vi.fn(), logOutAction: vi.fn() }));
// The session-expired dialog (#108) in the shell refreshes the page after logging in again.
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/server/auth/guard", () => ({ requireRole: vi.fn() }));
vi.mock("@/server/office-shell", () => ({ getOfficeShellViewer: vi.fn() }));

const root = new URL("../../", import.meta.url);
const read = (file: string) => readFileSync(new URL(file, root), "utf8");
const noCounts: OfficeCounts = { queues: 0, tradies: 0, support: 0 };
const someCounts: OfficeCounts = { queues: 9, tradies: 3, support: 2 };
const OFFICE: OfficeShellViewer = {
  role: "ADMIN",
  firstName: "Matt",
  lastName: "Larsen",
  email: "office@example.test",
};

function shell({
  viewer = OFFICE,
  counts = someCounts,
  testMode = true,
  at = "/admin",
  menuOpen = false,
  accountOpen = false,
}: { viewer?: OfficeShellViewer; counts?: OfficeCounts; testMode?: boolean; at?: string; menuOpen?: boolean; accountOpen?: boolean } = {}) {
  return renderToString(
    <OfficeShellView viewer={viewer} counts={counts} testMode={testMode} preview={{ at, base: "/dev/components/office-shell", menuOpen, accountOpen }}>
      <h1>Office page content</h1>
    </OfficeShellView>,
  );
}

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const currentAnchors = (html: string) => html.match(/<a\b(?=[^>]*aria-current="page")[^>]*>/g) ?? [];

beforeEach(() => {
  vi.mocked(requireRole).mockReset();
  vi.mocked(getOfficeShellViewer).mockReset();
});

describe("office navigation", () => {
  it("matches every sitemap label and URL in exactly the specified order", () => {
    const sitemap = JSON.parse(read("docs/design/sitemap.json")) as { navigation: { office: string[] } };
    expect(OFFICE_NAV.map(({ label, href }) => `${label} ${href}`)).toEqual(sitemap.navigation.office);
    expect(new Set(OFFICE_NAV.map(({ key }) => key)).size).toBe(9);
  });

  it("marks each section and its nested pages, without also marking Queues", () => {
    for (const link of OFFICE_NAV) {
      expect(currentOfficeLink(link.href)).toEqual(link);
      expect(currentOfficeLink(`${link.href}/`)).toEqual(link);
      if (link.href !== "/admin") expect(currentOfficeLink(`${link.href}/example`)).toEqual(link);
    }
    expect(currentOfficeLink("/admin/jobs/TM-1005")?.label).toBe("All jobs");
    expect(currentOfficeLink("/admin/tradies/person-1")?.label).toBe("Tradies");
  });

  it("keeps the sitemap's pricing, extra-work, dispute and sign-off pages inside Queues", () => {
    const sitemap = JSON.parse(read("docs/design/sitemap.json")) as { pages: { code: string; route: string }[] };
    const queuePages = sitemap.pages.filter(({ code }) => ["F02", "F03", "F06", "F07", "F15"].includes(code));
    expect(queuePages).toHaveLength(5);
    for (const { route } of queuePages) {
      const pathname = route.replace("[id]", "TM-1005");
      expect(currentOfficeLink(pathname)?.label, pathname).toBe("Queues");
    }
  });

  it("keeps queue-work descendants current after normalizing query, fragment and trailing slash", () => {
    for (const pathname of [
      "/admin/jobs/TM-1005/price/confirm",
      "/admin/jobs/TM-1005/price/?tab=builder#total",
      "/admin/variations",
      "/admin/variations/variation-1/evidence",
      "/admin/disputes/case-1",
      "/admin/signoff/TM-1005",
      "/admin/signoff/?tab=evidence#photos",
      "/admin/pricing/example",
    ]) {
      expect(currentOfficeLink(pathname)?.label, pathname).toBe("Queues");
    }
  });

  it("keeps ordinary job pages and similar-looking price paths under All jobs", () => {
    for (const pathname of [
      "/admin/jobs",
      "/admin/jobs/TM-1005",
      "/admin/jobs/TM-1005/payments",
      "/admin/jobs/price",
      "/admin/jobs/TM-1005/price-history",
      "/admin/jobs/TM-1005/prices",
      "/admin/jobs/TM-1005/other/price",
    ]) {
      expect(currentOfficeLink(pathname)?.label, pathname).toBe("All jobs");
    }
  });

  it("ignores query flags and fragments when matching a section", () => {
    expect(currentOfficeLink("/admin/settings?tab=team")?.label).toBe("Settings");
    expect(currentOfficeLink("/admin/support/#thread")?.label).toBe("Support");
  });

  it("does not mistake a route prefix or an unrelated page for a section", () => {
    for (const pathname of [
      null, "/", "/profile", "/adminx", "/admin/jobs-other", "/admin/unknown",
      "/admin/pricing-guide", "/admin/variations-old", "/admin/disputes-resolved", "/admin/signoff-settings",
    ]) {
      expect(currentOfficeLink(pathname), String(pathname)).toBeNull();
    }
  });

  it("uses the current page only once in the sidebar's HTML", () => {
    const links = currentAnchors(shell({ at: "/admin/tradies/example" }));
    expect(links).toHaveLength(1);
    expect(links[0]).toContain("at=%2Fadmin%2Ftradies");
  });

  it("marks only Queues in each navigation layout for the nested job-pricing workspace", () => {
    const links = currentAnchors(shell({ at: "/admin/jobs/TM-1005/price", menuOpen: true }));
    expect(links).toHaveLength(2);
    for (const link of links) expect(link).toContain('href="/dev/components/office-shell?at=%2Fadmin"');
  });

  it("keeps preview navigation local, preserves chosen states and closes preview menus", () => {
    expect(officeHref(undefined, "/admin/jobs")).toBe("/admin/jobs");
    const href = officeHref({ at: "/admin", base: "/dev/components/office-shell?counts=many&name=long&menu=open&account=open" }, "/admin/tradies");
    const target = new URL(href, "http://preview.invalid");
    expect(target.pathname).toBe("/dev/components/office-shell");
    expect(target.searchParams.get("at")).toBe("/admin/tradies");
    expect(target.searchParams.get("counts")).toBe("many");
    expect(target.searchParams.get("name")).toBe("long");
    expect(target.searchParams.has("menu")).toBe(false);
    expect(target.searchParams.has("account")).toBe(false);
  });

  it("announces queue counts as waiting work rather than unread messages", () => {
    expect(officeCountLabel("Queues", 0)).toBe("Queues");
    expect(officeCountLabel("Queues", 1)).toBe("Queues, 1 waiting");
    expect(officeCountLabel("Queues", 100)).toBe("Queues, 99+ waiting");
  });
});

describe("OfficeShellView", () => {
  it("puts the skip link first, then the navigation, the banner and a focusable main", () => {
    const html = shell();
    const firstAnchor = html.match(/<a\b[^>]*>/)?.[0];
    expect(firstAnchor).toContain('href="#main"');
    expect(html.indexOf("Skip to content")).toBeLessThan(html.indexOf("<nav"));
    expect(html.indexOf("<nav")).toBeLessThan(html.indexOf("Test mode."));
    expect(html.indexOf("Test mode.")).toBeLessThan(html.indexOf("<main"));
    expect(html).toMatch(/<main\b(?=[^>]*id="main")(?=[^>]*tabindex="-1")[^>]*>/);
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html).toContain("Office page content");
  });

  it("uses office colours even when rendered outside an authenticated layout", () => {
    expect(shell()).toContain('data-mode="office"');
  });

  it("shows the required payment message only in test mode", () => {
    expect(text(shell())).toContain("Test mode.");
    expect(text(shell({ testMode: false }))).not.toContain("Test mode.");
  });

  it("announces waiting counts with the links and keeps the visual badge decorative", () => {
    const html = shell();
    for (const [label, count] of [["Queues", 9], ["Tradies", 3], ["Support", 2]]) {
      expect(html).toContain(`aria-label="${label}, ${count} waiting"`);
      expect(html).toMatch(new RegExp(`<span\\b(?=[^>]*aria-hidden="true")[^>]*>${count}<\\/span>`));
    }
    expect(html).not.toContain("unread");
  });

  it("does not show a badge when no items are waiting", () => {
    const html = shell({ counts: noCounts });
    expect(html).not.toMatch(/aria-label="[^"]*, [^"]* waiting"/);
    expect(html).not.toMatch(/<span\b(?=[^>]*aria-hidden="true")[^>]*>0<\/span>/);
  });

  it("defaults omitted counts to zero separately from the viewer", () => {
    const html = renderToString(<OfficeShellView viewer={OFFICE} testMode={false}><h1>Office page content</h1></OfficeShellView>);
    expect(html).not.toContain("waiting");
    expect(html).not.toMatch(/<span\b(?=[^>]*aria-hidden="true")[^>]*>0<\/span>/);
  });

  it("ignores extra counts on links without a queue in both navigation layouts", () => {
    // A runtime object can have more properties than OfficeCounts; they must not create new badges.
    const injectedCounts = { ...someCounts, jobs: 12, customers: 13, payouts: 14, payments: 15, reviews: 16, settings: 17 };
    const html = shell({ counts: injectedCounts, menuOpen: true });
    const anchors = html.match(/<a\b[^>]*>[\s\S]*?<\/a>/g) ?? [];
    for (const link of OFFICE_NAV.filter(({ key }) => !["queues", "tradies", "support"].includes(key))) {
      const matches = anchors.filter((anchor) => anchor.includes(`at=${encodeURIComponent(link.href)}`));
      expect(matches, link.label).toHaveLength(2);
      for (const anchor of matches) {
        expect(anchor, link.label).not.toContain("waiting");
        expect(anchor, link.label).not.toMatch(/<span\b(?=[^>]*aria-hidden="true")[^>]*>\d+\+?<\/span>/);
      }
    }
  });

  it("caps large counts at 99+ and tolerates invalid counts", () => {
    for (const support of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      const html = shell({ counts: { queues: 100, tradies: 99, support } });
      expect(html).toContain('aria-label="Queues, 99+ waiting"');
      expect(html).toContain('aria-label="Tradies, 99 waiting"');
      expect(html).toContain(">99+</span>");
      expect(html).not.toContain('aria-label="Support,');
      expect(html).not.toMatch(/NaN|Infinity|-1 waiting/);
    }
  });

  it("names the avatar with the full name and uses the shared initials fallback", () => {
    expect(shell()).toContain('aria-label="Account: Matt Larsen"');
    expect(shell()).toMatch(/>ML<\/span>/);
    const singleName = shell({ viewer: { ...OFFICE, firstName: "Wiremu", lastName: null } });
    expect(singleName).toContain('aria-label="Account: Wiremu"');
    expect(singleName).toMatch(/>W<\/span>/);
  });

  it("offers only Help and Log out below the viewer's name and email", () => {
    const html = shell({ accountOpen: true });
    // Each responsive copy has the same two menu items; office users have no Account destination yet.
    const menuItems = html.match(/<(?:a|button)\b(?=[^>]*role="menuitem")[^>]*>[\s\S]*?<\/(?:a|button)>/g) ?? [];
    expect(menuItems.length).toBeGreaterThanOrEqual(2);
    expect(menuItems.length % 2).toBe(0);
    for (let i = 0; i < menuItems.length; i += 2) {
      expect(text(menuItems[i])).toMatch(/Help/);
      expect(menuItems[i]).toContain('href="/help"');
      expect(text(menuItems[i + 1])).toMatch(/Log out/);
    }
    expect(menuItems.join("")).not.toMatch(/href="\/(?:profile|admin\/settings)"|>Account</);
    expect(text(html)).toContain("Matt Larsen");
    expect(text(html)).toContain(OFFICE.email);
    expect(html).not.toContain("Notification settings");
  });

  it("uses a server-action form for logout and never exposes a logout GET link", () => {
    const html = shell({ accountOpen: true });
    expect(html).toMatch(/<form\b[^>]*hidden/);
    expect(html).not.toMatch(/href="[^"]*log-?out/i);
    // React server actions choose POST; verify the component passes the real action to its form.
    expect(read("src/components/office/OfficeNav.tsx")).toMatch(/<form\b[^>]*action=\{logOutAction\}/);
  });
});

describe("OfficeShell and the /admin layout", () => {
  it("checks ADMIN on the server before loading or rendering office data", async () => {
    const denied = new Error("redirect to login");
    vi.mocked(requireRole).mockRejectedValueOnce(denied);
    await expect(OfficeShell({ children: <h1>Private content</h1> })).rejects.toBe(denied);
    expect(requireRole).toHaveBeenCalledWith(["ADMIN"], { next: "/admin" });
    expect(getOfficeShellViewer).not.toHaveBeenCalled();
  });

  it("passes the verified viewer to the loader, supplied counts to the frame and enables test mode", async () => {
    const viewer = { userId: "office-1", role: "ADMIN" as const, firstName: "Matt", email: "office@example.test", emailVerified: true };
    vi.mocked(requireRole).mockResolvedValueOnce(viewer);
    vi.mocked(getOfficeShellViewer).mockResolvedValueOnce(OFFICE);
    const element = await OfficeShell({ children: <h1>Private content</h1>, counts: someCounts });
    expect(getOfficeShellViewer).toHaveBeenCalledWith(viewer);
    const html = renderToString(element);
    expect(html).toContain("Private content");
    expect(html).toContain('data-mode="office"');
    expect(html).toContain("Test mode.");
    expect(html).toContain('aria-label="Queues, 9 waiting"');
    expect(html).toContain('aria-label="Tradies, 3 waiting"');
    expect(html).toContain('aria-label="Support, 2 waiting"');
  });

  it("leaves badges empty when the page has not supplied queue counts", async () => {
    vi.mocked(requireRole).mockResolvedValueOnce({ userId: "office-1", role: "ADMIN", firstName: "Matt", email: "office@example.test", emailVerified: true });
    vi.mocked(getOfficeShellViewer).mockResolvedValueOnce(OFFICE);
    const html = renderToString(await OfficeShell({ children: <h1>Private content</h1> }));
    expect(html).toContain("Private content");
    expect(html).not.toContain("waiting");
  });

  it("never renders children when the loader supplies no authorized viewer", async () => {
    vi.mocked(requireRole).mockResolvedValueOnce({ userId: "office-1", role: "ADMIN", firstName: "Matt", email: "office@example.test", emailVerified: true });
    vi.mocked(getOfficeShellViewer).mockResolvedValueOnce(null);
    expect(await OfficeShell({ children: <h1>Private content</h1> })).toBeNull();
  });

  it("wraps every admin page in OfficeShell and enables the safe area", () => {
    const child = <h1>Office page</h1>;
    const layout = OfficeLayout({ children: child });
    expect(layout.type).toBe(OfficeShell);
    expect(layout.props.children).toBe(child);
    expect(officeViewport).toEqual({ viewportFit: "cover" });
  });
});
