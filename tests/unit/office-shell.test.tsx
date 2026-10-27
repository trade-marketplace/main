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
vi.mock("@/server/auth/actions", () => ({ logOutAction: vi.fn() }));
vi.mock("@/server/auth/guard", () => ({ requireRole: vi.fn() }));
vi.mock("@/server/office-shell", () => ({ getOfficeShellViewer: vi.fn() }));

const root = new URL("../../", import.meta.url);
const read = (file: string) => readFileSync(new URL(file, root), "utf8");
const noCounts: OfficeCounts = {
  queues: 0, jobs: 0, tradies: 0, customers: 0, payouts: 0, payments: 0, reviews: 0, support: 0, settings: 0,
};
const OFFICE: OfficeShellViewer = {
  role: "ADMIN",
  firstName: "Matt",
  lastName: "Larsen",
  email: "office@example.test",
  counts: { ...noCounts, queues: 9, tradies: 3, support: 2 },
};

function shell({
  viewer = OFFICE,
  testMode = true,
  at = "/admin",
  accountOpen = false,
}: { viewer?: OfficeShellViewer; testMode?: boolean; at?: string; accountOpen?: boolean } = {}) {
  return renderToString(
    <OfficeShellView viewer={viewer} testMode={testMode} preview={{ at, base: "/dev/components/office-shell", accountOpen }}>
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

  it("keeps pricing work inside Queues", () => {
    expect(currentOfficeLink("/admin/pricing")?.label).toBe("Queues");
    expect(currentOfficeLink("/admin/pricing/example")?.label).toBe("Queues");
  });

  it("ignores query flags and fragments when matching a section", () => {
    expect(currentOfficeLink("/admin/settings?tab=team")?.label).toBe("Settings");
    expect(currentOfficeLink("/admin/support/#thread")?.label).toBe("Support");
  });

  it("does not mistake a route prefix or an unrelated page for a section", () => {
    for (const pathname of [null, "/", "/profile", "/adminx", "/admin/jobs-other", "/admin/unknown"]) {
      expect(currentOfficeLink(pathname), String(pathname)).toBeNull();
    }
  });

  it("uses the current page only once in the sidebar's HTML", () => {
    const links = currentAnchors(shell({ at: "/admin/tradies/example" }));
    expect(links).toHaveLength(1);
    expect(links[0]).toContain("at=%2Fadmin%2Ftradies");
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
    expect(officeCountLabel("Payouts", 0)).toBe("Payouts");
    expect(officeCountLabel("Payouts", 1)).toBe("Payouts, 1 waiting");
    expect(officeCountLabel("Payouts", 100)).toBe("Payouts, 99+ waiting");
  });
});

describe("OfficeShellView", () => {
  it("puts the skip link before the banner and navigation, with a focusable main after them", () => {
    const html = shell();
    const firstAnchor = html.match(/<a\b[^>]*>/)?.[0];
    expect(firstAnchor).toContain('href="#main"');
    expect(html.indexOf("Skip to content")).toBeLessThan(html.indexOf("Test mode."));
    expect(html.indexOf("Test mode.")).toBeLessThan(html.indexOf("<nav"));
    expect(html.indexOf("<nav")).toBeLessThan(html.indexOf("<main"));
    expect(html).toMatch(/<main\b(?=[^>]*id="main")(?=[^>]*tabindex="-1")[^>]*>/);
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html).toContain("Office page content");
  });

  it("uses office colours even when rendered outside an authenticated layout", () => {
    expect(shell()).toContain('data-mode="office"');
  });

  it("shows the required payment message only in test mode", () => {
    expect(text(shell())).toContain("Test mode. No real money moves.");
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
    const html = shell({ viewer: { ...OFFICE, counts: noCounts } });
    expect(html).not.toMatch(/aria-label="[^"]*, [^"]* waiting"/);
    expect(html).not.toMatch(/<span\b(?=[^>]*aria-hidden="true")[^>]*>0<\/span>/);
  });

  it("caps large counts at 99+ and tolerates invalid counts", () => {
    const html = shell({ viewer: { ...OFFICE, counts: { ...noCounts, queues: 100, tradies: 99, support: Number.NaN, payouts: -1 } } });
    expect(html).toContain('aria-label="Queues, 99+ waiting"');
    expect(html).toContain('aria-label="Tradies, 99 waiting"');
    expect(html).toContain(">99+</span>");
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("-1 waiting");
  });

  it("names the avatar with the full name and uses the shared initials fallback", () => {
    expect(shell()).toContain('aria-label="Account: Matt Larsen"');
    expect(shell()).toMatch(/>ML<\/span>/);
    const singleName = shell({ viewer: { ...OFFICE, firstName: "Wiremu", lastName: null } });
    expect(singleName).toContain('aria-label="Account: Wiremu"');
    expect(singleName).toMatch(/>W<\/span>/);
  });

  it("offers exactly Account, Help and Log out in the avatar menu", () => {
    const html = shell({ accountOpen: true });
    // Each responsive copy has the same three menu items, never customer payment settings.
    const menuItems = html.match(/<(?:a|button)\b(?=[^>]*role="menuitem")[^>]*>[\s\S]*?<\/(?:a|button)>/g) ?? [];
    expect(menuItems.length).toBeGreaterThanOrEqual(3);
    expect(menuItems.length % 3).toBe(0);
    for (let i = 0; i < menuItems.length; i += 3) {
      expect(text(menuItems[i])).toMatch(/Account/);
      expect(text(menuItems[i + 1])).toMatch(/Help/);
      expect(text(menuItems[i + 2])).toMatch(/Log out/);
    }
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

  it("passes the verified viewer to the loader and enables the shared test-mode banner", async () => {
    const viewer = { userId: "office-1", role: "ADMIN" as const, firstName: "Matt", email: "office@example.test", emailVerified: true };
    vi.mocked(requireRole).mockResolvedValueOnce(viewer);
    vi.mocked(getOfficeShellViewer).mockResolvedValueOnce(OFFICE);
    const element = await OfficeShell({ children: <h1>Private content</h1> });
    expect(getOfficeShellViewer).toHaveBeenCalledWith(viewer);
    const html = renderToString(element);
    expect(html).toContain("Private content");
    expect(html).toContain('data-mode="office"');
    expect(html).toContain("Test mode.");
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
