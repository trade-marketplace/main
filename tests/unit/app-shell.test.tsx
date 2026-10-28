import { readFileSync } from "node:fs";

import { renderToString } from "react-dom/server";
import { prerender } from "react-dom/static";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AppLayout, { viewport as appViewport } from "@/app/(app)/layout";
import { AppShell } from "@/components/app/AppShell";
import { AppShellView, type ShellViewer } from "@/components/app/AppShellView";
import {
  accountMenuItems,
  BOTTOM_NAV,
  countLabel,
  countText,
  currentLink,
  fullName,
  isAppRole,
  isFullScreenFlow,
  linkHref,
  TOP_NAV,
} from "@/components/app/app-links";
import { loadShellViewer, paymentsInTestMode } from "@/server/app-shell";
import { getViewer, type Viewer } from "@/server/auth/viewer";
import { DatabaseNotConfiguredError } from "@/server/db";

// The shell reads the signed-in visitor on the server. Tests choose who that is; nobody by default.
vi.mock("@/server/auth/viewer", () => ({ getViewer: vi.fn(async () => null) }));
// Log out is a server action; the shell only hands it to a form.
vi.mock("@/server/auth/actions", () => ({ logInAgainAction: vi.fn(), logOutAction: vi.fn() }));
// The session-expired dialog (#108) in the shell refreshes the page after logging in again.
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
// No test talks to a database: the shell's one query gets a fake row.
const findUnique = vi.fn();
vi.mock("@/server/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/db")>()),
  getDb: () => ({ profile: { findUnique } }),
}));

const root = new URL("../../", import.meta.url);
const read = (file: string) => readFileSync(new URL(file, root), "utf8");

const SARAH: ShellViewer = {
  role: "CUSTOMER",
  firstName: "Sarah",
  lastName: "Thompson",
  email: "sarah@email.co.nz",
  counts: { messages: 1, notifications: 2 },
};
const JACK: ShellViewer = { ...SARAH, role: "TRADIE", firstName: "Jack", lastName: "Wilson", email: "jack@example.nz" };

const viewerRow = (over: Partial<Viewer> = {}): Viewer => ({
  userId: "user-1",
  email: "sarah@email.co.nz",
  role: "CUSTOMER",
  firstName: "Sarah",
  emailVerified: true,
  ...over,
});

const shell = (viewer: ShellViewer, { testMode = true, at = "/" } = {}) =>
  renderToString(
    <AppShellView viewer={viewer} testMode={testMode} preview={{ at, base: "/dev/components/app-shell" }}>
      <h1>Page</h1>
    </AppShellView>,
  );

/** The text a screen reader gets from some HTML: tags and aria-hidden parts (icons, badges) removed. */
const texts = (html: string) =>
  html
    .replace(/<span[^>]*aria-hidden="true"[^>]*>[^<]*<\/span>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");

beforeEach(() => findUnique.mockReset());
afterEach(() => {
  vi.mocked(getViewer).mockReset().mockResolvedValue(null);
  vi.restoreAllMocks();
});

describe("the nav links", () => {
  const sitemap = JSON.parse(read("docs/design/sitemap.json")) as {
    pages: { route: string }[];
    navigation: Record<string, string[]>;
  };
  const planned = new Set(sitemap.pages.map((p) => p.route.replace(" (signed in)", "")));

  it("has the sitemap's top nav for each mode, in order", () => {
    const names = (lines: string[]) => lines.filter((l) => !l.startsWith("+")).map((l) => l.split(" /")[0]);
    expect(TOP_NAV.CUSTOMER.map((l) => l.label)).toEqual(names(sitemap.navigation.customer));
    expect(TOP_NAV.TRADIE.map((l) => l.label)).toEqual(names(sitemap.navigation.trade));
  });

  it("has five icons on the phone, as in the mockups, with Post a job where customers have no search (#84)", () => {
    expect(BOTTOM_NAV.CUSTOMER.map((l) => l.label)).toEqual(["Home", "Post a job", "My jobs", "Messages", "Account"]);
    expect(BOTTOM_NAV.TRADIE.map((l) => l.label)).toEqual(["Find work", "All jobs", "My work", "Messages", "Account"]);
    expect(BOTTOM_NAV.TRADIE.map((l) => l.icon)).toEqual(["home", "search", "wallet", "chat_bubble", "person"]);
  });

  it("only links to routes the sitemap plans", () => {
    const hrefs = [
      ...Object.values(TOP_NAV).flat(),
      ...Object.values(BOTTOM_NAV).flat(),
      ...accountMenuItems("CUSTOMER"),
      ...accountMenuItems("TRADIE"),
    ].map((l) => l.href);
    for (const href of hrefs) expect(planned, href).toContain(href);
    expect(planned).toContain("/notifications");
  });

  it("is only for customers and tradies (the office has its own shell)", () => {
    expect(isAppRole("CUSTOMER")).toBe(true);
    expect(isAppRole("TRADIE")).toBe(true);
    expect(isAppRole("ADMIN")).toBe(false);
  });
});

describe("currentLink", () => {
  const label = (links: Parameters<typeof currentLink>[0], path: string | null, view: string | null = null) =>
    currentLink(links, path, view)?.label ?? null;

  it("marks the page and the pages under it, with or without a trailing slash", () => {
    expect(label(TOP_NAV.CUSTOMER, "/")).toBe("Home");
    expect(label(TOP_NAV.CUSTOMER, "/dashboard/")).toBe("My jobs");
    expect(label(TOP_NAV.CUSTOMER, "/messages/TM-1005")).toBe("Messages");
    expect(label(TOP_NAV.CUSTOMER, "/messagesx")).toBeNull();
  });

  it("marks nothing on pages that aren't in the nav", () => {
    for (const path of ["/notifications", "/help", "/jobs/TM-1005", null]) expect(label(TOP_NAV.CUSTOMER, path)).toBeNull();
  });

  it("keeps a tradie on Find work across the board, its map and a job's page", () => {
    for (const [path, view] of [["/jobs", null], ["/jobs", "map"], ["/jobs/TM-1005", null]] as const) {
      expect(label(TOP_NAV.TRADIE, path, view)).toBe("Find work");
    }
  });

  it("tells the phone's Find work and All jobs apart by ?view=all", () => {
    expect(label(BOTTOM_NAV.TRADIE, "/jobs")).toBe("Find work");
    expect(label(BOTTOM_NAV.TRADIE, "/jobs", "map")).toBe("Find work");
    expect(label(BOTTOM_NAV.TRADIE, "/jobs", "all")).toBe("All jobs");
    expect(linkHref(BOTTOM_NAV.TRADIE[1])).toBe("/jobs?view=all");
  });

  it("puts Earnings under Account on a phone, and on its own tab on a computer", () => {
    expect(label(BOTTOM_NAV.TRADIE, "/earnings")).toBe("Account");
    expect(label(BOTTOM_NAV.TRADIE, "/profile/payroll")).toBe("Account");
    expect(label(TOP_NAV.TRADIE, "/earnings/estimates")).toBe("Earnings");
  });

  it("never marks Home for Post a job", () => {
    expect(label(BOTTOM_NAV.CUSTOMER, "/jobs/new")).toBe("Post a job");
    expect(label(TOP_NAV.CUSTOMER, "/jobs/new")).toBeNull();
  });
});

describe("isFullScreenFlow", () => {
  it("hides the bottom bar for post a job, estimate, extra work, finish job, booking and pay", () => {
    for (const path of ["/jobs/new", "/jobs/new/", "/jobs/TM-1/estimate", "/jobs/TM-1/variation", "/jobs/TM-1/complete", "/jobs/TM-1/book", "/pay/p_1"]) {
      expect(isFullScreenFlow(path), path).toBe(true);
    }
  });

  it("keeps it everywhere else", () => {
    for (const path of ["/", "/jobs", "/jobs/TM-1", "/dashboard", "/payments", "/profile/payments", null]) {
      expect(isFullScreenFlow(path), String(path)).toBe(false);
    }
  });
});

describe("counts", () => {
  it("shows up to 99, then 99+, and nothing for none", () => {
    expect(countText(0)).toBeNull();
    expect(countText(undefined)).toBeNull();
    expect(countText(-2)).toBeNull();
    expect(countText(Number.NaN)).toBeNull();
    expect(countText(1)).toBe("1");
    expect(countText(99)).toBe("99");
    expect(countText(100)).toBe("99+");
  });

  it("reads the count with the link's name", () => {
    expect(countLabel("Messages", 3)).toBe("Messages, 3 unread");
    expect(countLabel("Messages", 0)).toBe("Messages");
    expect(countLabel("Notifications", 250)).toBe("Notifications, 99+ unread");
  });
});

describe("the avatar menu", () => {
  it("has the spec's items for a customer (E02 note 3)", () => {
    expect(accountMenuItems("CUSTOMER").map((i) => i.label)).toEqual(["Account", "Payments", "Notification settings", "Help"]);
  });

  it("leaves Payments out for a tradie (it's a customer page)", () => {
    expect(accountMenuItems("TRADIE").map((i) => i.label)).toEqual(["Account", "Notification settings", "Help"]);
  });

  it("names the person in full when it can", () => {
    expect(fullName("Sarah", "Thompson")).toBe("Sarah Thompson");
    expect(fullName("Wiremu", null)).toBe("Wiremu");
    expect(fullName("  ", "  ")).toBe("Your account");
  });
});

describe("loadShellViewer", () => {
  const extras = vi.fn();

  it("is null when signed out, and for the office", async () => {
    expect(await loadShellViewer(null, { findExtras: extras })).toBeNull();
    expect(await loadShellViewer(viewerRow({ role: "ADMIN" }), { findExtras: extras })).toBeNull();
    expect(extras).not.toHaveBeenCalled();
  });

  it("adds the last name and the unread notifications, and never the user id", async () => {
    extras.mockResolvedValueOnce({ lastName: "Thompson", unreadNotifications: 4 });
    const viewer = await loadShellViewer(viewerRow(), { findExtras: extras });
    expect(viewer).toEqual({
      role: "CUSTOMER",
      firstName: "Sarah",
      lastName: "Thompson",
      email: "sarah@email.co.nz",
      emailVerified: true,
      counts: { notifications: 4, messages: 0 },
    });
    expect(JSON.stringify(viewer)).not.toContain("user-1");
  });

  it("still shows the shell, with the first name and no badge, if the extras can't be read", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    extras.mockRejectedValueOnce(new Error("connection reset"));
    expect(await loadShellViewer(viewerRow({ role: "TRADIE" }), { findExtras: extras })).toMatchObject({
      role: "TRADIE",
      lastName: null,
      counts: { notifications: 0, messages: 0 },
    });
    expect(log).toHaveBeenCalledOnce();
  });

  it("doesn't log on every page when there's simply no database yet", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    extras.mockRejectedValueOnce(new DatabaseNotConfiguredError());
    expect(await loadShellViewer(viewerRow(), { findExtras: extras })).toMatchObject({ lastName: null });
    expect(log).not.toHaveBeenCalled();
  });
});

describe("paymentsInTestMode", () => {
  it("stays on until both founders switch real payments on (AGENTS.md)", () => {
    expect(paymentsInTestMode()).toBe(true);
  });
});

describe("AppShellView", () => {
  it("asks someone who hasn't confirmed their email to do it, and nobody else (#102)", () => {
    expect(texts(shell({ ...SARAH, emailVerified: false }))).toContain("Confirm your email.");
    expect(shell({ ...SARAH, emailVerified: false })).toContain('href="/verify"');
    expect(texts(shell(SARAH))).not.toContain("Confirm your email");
    expect(texts(shell({ ...SARAH, emailVerified: true }))).not.toContain("Confirm your email");
  });

  it("puts a skip link first, then the banner, the top nav, main and the bottom bar", () => {
    const html = shell(SARAH);
    expect(html.indexOf("Skip to content")).toBeLessThan(html.indexOf("Test mode."));
    expect(html.indexOf("Test mode.")).toBeLessThan(html.indexOf("<header"));
    expect(html.indexOf("<header")).toBeLessThan(html.indexOf('<main id="main"'));
    expect(html.lastIndexOf("<nav")).toBeGreaterThan(html.indexOf("</main>"));
    expect(html).toMatch(/<a href="#main"[^>]*>Skip to content<\/a>/);
    expect(html).toMatch(/<main id="main" tabindex="-1"/);
  });

  it("shows the test-mode banner only while payments are in test mode", () => {
    expect(texts(shell(SARAH))).toContain("Test mode.");
    expect(texts(shell(SARAH, { testMode: false }))).not.toContain("Test mode");
  });

  it("paints itself in the person's mode", () => {
    expect(shell(SARAH)).toContain('data-mode="customer"');
    expect(shell(JACK)).toContain('data-mode="trade"');
  });

  it("gives a customer Home, My jobs, Messages and Post a job, with Home current", () => {
    const html = shell(SARAH);
    const header = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
    expect(texts(header)).toMatch(/Home My jobs Messages , 1 unread Post a job/);
    expect(header).toMatch(/<a class="[^"]*topLink[^"]*" aria-current="page" href="\/dev\/components\/app-shell\?at=%2F">/);
    expect(header).not.toContain("Tradie");
  });

  it("gives a tradie the Tradie flag, Find work, My work, Earnings and Messages, and no Post a job", () => {
    const html = shell(JACK, { at: "/jobs" });
    const header = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
    expect(texts(header)).toMatch(/Tradie Find work My work Earnings Messages/);
    expect(texts(header)).not.toContain("Post a job");
  });

  it("names the bell and the bottom bar's icons with their counts, and hides the badges from screen readers", () => {
    const html = shell(SARAH);
    expect(html).toContain('aria-label="Notifications, 2 unread"');
    expect(html).toContain('aria-label="Messages, 1 unread"');
    expect(html).toMatch(/<span class="[^"]*count[^"]*" aria-hidden="true">2<\/span>/);
    for (const name of ["Home", "Post a job", "My jobs", "Account"]) expect(html).toContain(`aria-label="${name}"`);
  });

  it("shows the avatar's initials and names its button", () => {
    const html = shell(SARAH);
    expect(html).toContain('aria-label="Account: Sarah Thompson"');
    expect(html).toMatch(/aria-haspopup="menu"/);
    expect(html).toMatch(/>ST<\/span>/);
  });

  it("logs out with a POST form, never a link", () => {
    const html = shell(SARAH);
    expect(html).toMatch(/<form[^>]*hidden/);
    expect(html).not.toMatch(/href="[^"]*log-?out/i);
  });

  it("drops the bottom bar (and its spacer) in full-screen flows", () => {
    const html = shell(SARAH, { at: "/jobs/new" });
    expect(html).not.toContain('aria-label="My jobs"');
    expect(html).not.toContain("bottomSpacer");
  });

  it("hides the sliding bar when no tab is current", () => {
    expect(shell(SARAH, { at: "/notifications" })).not.toContain('data-shown="true"');
    expect(shell(SARAH)).toContain('data-shown="true"');
  });
});

describe("AppShell and the (app) layout", () => {
  async function html(node: React.ReactNode) {
    const { prelude } = await prerender(node);
    return new Response(prelude).text();
  }

  it("reads who is signed in on the server and fills the shell", async () => {
    vi.mocked(getViewer).mockResolvedValue(viewerRow({ role: "TRADIE", firstName: "Jack" }));
    findUnique.mockResolvedValue({ lastName: "Wilson", _count: { notifications: 3 } });
    const out = await html(await AppLayout({ children: <h1>Board</h1> }));
    expect(out).toContain('aria-label="Account: Jack Wilson"');
    expect(out).toContain('aria-label="Notifications, 3 unread"');
    expect(out).toContain("Test mode.");
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "user-1" }, select: expect.objectContaining({ lastName: true }) }),
    );
  });

  it("shows the page without the nav for someone the app isn't for (the proxy normally stops them first)", async () => {
    const out = await html(await AppShell({ children: <h1>Board</h1> }));
    expect(out).toContain('<main id="main"');
    expect(out).not.toContain("<header");
    expect(out).toContain("Board");
  });

  it("lets the bottom bar use the phone's safe area", () => {
    expect(appViewport).toEqual({ viewportFit: "cover" });
  });
});

describe("app.module.css", () => {
  const css = read("src/components/app/app.module.css");

  it("pads the bottom bar by the safe area and keeps that much room at the end of the page", () => {
    expect(css).toMatch(/--app-bottom-h: calc\(var\(--trade-nav-height\) \+ env\(safe-area-inset-bottom/);
    expect(css).toMatch(/\.bottomSpacer \{ height: var\(--app-bottom-h\)/);
    expect(css).toMatch(/\.bottomNav \{[^}]*position: fixed;[^}]*env\(safe-area-inset-bottom, 0px\)/s);
  });

  it("swaps the bottom bar for the top nav at 1024px", () => {
    expect(css).toMatch(/\.header \{ display: none; \}/);
    expect(css).toMatch(/@media \(min-width: 1024px\) \{\s*\.bottomNav,\s*\.bottomSpacer \{ display: none; \}/);
  });

  it("uses the mockup's sizes: 68px top nav, 64px bottom bar, 3px bars", () => {
    expect(css).toMatch(/min-height: 68px/);
    expect(read("src/styles/tokens.css")).toMatch(/--trade-nav-height: 64px/);
    expect(css.match(/height: 3px/g)).toHaveLength(2);
  });
});
