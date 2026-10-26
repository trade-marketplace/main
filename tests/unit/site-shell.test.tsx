import { readFileSync } from "node:fs";

import { renderToString } from "react-dom/server";
import { prerender } from "react-dom/static";
import { afterEach, describe, expect, it, vi } from "vitest";

import SiteLayout from "@/app/(site)/layout";
import { parseTokens } from "@/app/dev/tokens/parse-tokens";
import { SiteFooter } from "@/components/site/SiteFooter";
import { SiteShell, SiteShellView, siteViewer } from "@/components/site/SiteShell";
import {
  FOOTER_COLUMNS,
  headerActions,
  isCurrent,
  SITE_NAV,
  type SiteViewer,
} from "@/components/site/site-links";
import { Wordmark } from "@/components/Wordmark";
import { getViewer, type Viewer } from "@/server/auth/viewer";

// The shell reads the signed-in visitor on the server. Tests choose who that is; nobody by default.
vi.mock("@/server/auth/viewer", () => ({ getViewer: vi.fn(async () => null) }));

afterEach(() => vi.mocked(getViewer).mockReset().mockResolvedValue(null));

const root = new URL("../../", import.meta.url);
const read = (file: string) => readFileSync(new URL(file, root), "utf8");

const CUSTOMER: SiteViewer = { firstName: "Aroha", role: "CUSTOMER" };
const TRADIE: SiteViewer = { firstName: "Wiremu", role: "TRADIE" };
const OFFICE: SiteViewer = { firstName: "Matt", role: "ADMIN" };

function signInAs(viewer: SiteViewer) {
  const full: Viewer = { userId: "user-1", email: "secret-email@example.nz", emailVerified: true, ...viewer };
  vi.mocked(getViewer).mockResolvedValue(full);
}

const shell = (viewer: SiteViewer | null) => renderToString(<SiteShellView viewer={viewer}><h1>Page</h1></SiteShellView>);

/** The visible text of some HTML, tags removed. */
const texts = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("headerActions", () => {
  it("offers Post a job, Log in and Sign up when signed out", () => {
    expect(headerActions(null)).toEqual({
      postJob: { label: "Post a job", href: "/jobs/new" },
      guest: { logIn: { label: "Log in", href: "/login" }, signUp: { label: "Sign up", href: "/signup" } },
      app: null,
      account: null,
    });
  });

  it("gives a customer their jobs, their account and Post a job", () => {
    expect(headerActions(CUSTOMER)).toEqual({
      postJob: { label: "Post a job", href: "/jobs/new" },
      guest: null,
      app: { label: "My jobs", href: "/dashboard" },
      account: { name: "Aroha", href: "/profile" },
    });
  });

  it("gives a tradie Find work and their account, and no Post a job (tradies can't post)", () => {
    expect(headerActions(TRADIE)).toMatchObject({ postJob: null, guest: null, app: { label: "Find work", href: "/jobs" } });
    expect(headerActions(TRADIE).account).toEqual({ name: "Wiremu", href: "/profile" });
  });

  it("gives the office its own home and no account link (it has no /profile)", () => {
    expect(headerActions(OFFICE)).toMatchObject({ postJob: null, app: { label: "Office", href: "/admin" }, account: null });
  });

  it("falls back to 'Your account' when the first name is blank", () => {
    expect(headerActions({ firstName: "   ", role: "CUSTOMER" }).account?.name).toBe("Your account");
  });
});

describe("isCurrent", () => {
  it("matches the page and the pages under it, with or without a trailing slash", () => {
    expect(isCurrent("/help", "/help")).toBe(true);
    expect(isCurrent("/help/", "/help")).toBe(true);
    expect(isCurrent("/help/claim-a-job", "/help")).toBe(true);
    expect(isCurrent("/helpful", "/help")).toBe(false);
    expect(isCurrent("/how-it-works", "/")).toBe(false);
    expect(isCurrent(null, "/help")).toBe(false);
  });
});

describe("links", () => {
  const sitemap = JSON.parse(read("docs/design/sitemap.json")) as { pages: { code: string; route: string }[] };
  const route = (code: string) => sitemap.pages.find((p) => p.code === code)!.route;

  it("only links to routes the sitemap plans", () => {
    const planned = new Set(sitemap.pages.map((p) => p.route));
    const hrefs = [...SITE_NAV, ...FOOTER_COLUMNS.flatMap((c) => c.links)].map((l) => l.href);
    for (const href of hrefs) expect(planned, href).toContain(href);
  });

  it("puts every public information page and every legal page in the footer", () => {
    const footer = new Set(FOOTER_COLUMNS.flatMap((c) => c.links.map((l) => l.href)));
    for (const code of ["A02", "A03", "A06", "A08", "A09", "A10", "A13", "A14", "A15", "A16"]) {
      expect(footer, code).toContain(route(code));
    }
  });

  it("has the header nav from the mockup, in order", () => {
    expect(SITE_NAV.map((l) => l.label)).toEqual(["How it works", "For tradies", "Help"]);
  });
});

describe("SiteShellView", () => {
  it("puts a skip link first, then the header, main and footer landmarks", () => {
    const html = shell(null);
    const order = ["Skip to content", "<header", '<main id="main"', "<footer"].map((s) => html.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toMatch(/<a href="#main"[^>]*>Skip to content<\/a>/);
    expect(html).toMatch(/<main id="main" tabindex="-1"/);
  });

  it("names the navs so screen readers can tell them apart", () => {
    const html = shell(null);
    for (const name of ["Main", "Menu", "Footer"]) expect(html).toContain(`aria-label="${name}"`);
  });

  it("shows Log in and Sign up when signed out, and no account", () => {
    const text = texts(shell(null));
    expect(text).toContain("Log in");
    expect(text).toContain("Sign up");
    expect(text).toContain("Post a job");
    expect(text).not.toContain("Your account");
  });

  it("shows a signed-in customer their name and jobs instead of Log in", () => {
    const html = shell(CUSTOMER);
    expect(texts(html)).toContain("Your account: Aroha");
    expect(texts(html)).toContain("My jobs");
    expect(html).not.toContain('href="/login"');
    expect(html).not.toContain('href="/signup"');
  });

  it("shows a signed-in tradie Find work and no Post a job in the header", () => {
    const html = shell(TRADIE);
    const header = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
    expect(texts(header)).toContain("Find work");
    expect(texts(header)).not.toContain("Post a job");
  });

  it("has a menu button that says whether the menu is open and which panel it opens", () => {
    const html = shell(null);
    const button = /<button[^>]*aria-label="Menu"[^>]*>/.exec(html)?.[0] ?? "";
    expect(button).toContain('aria-expanded="false"');
    const panel = /aria-controls="([^"]+)"/.exec(button)?.[1];
    expect(panel).toBeTruthy();
    // The panel starts closed (hidden) and holds the menu nav.
    expect(html).toMatch(new RegExp(`<div id="${panel}"[^>]*hidden`));
  });

  it("keeps a long name in the account link whole for screen readers (CSS cuts it off with …)", () => {
    const long = "Te Rangi-Hēnare-Fitzgerald-MacPherson Wolfeschlegelsteinhausen";
    expect(texts(shell({ firstName: long, role: "CUSTOMER" }))).toContain(`Your account: ${long}`);
    const css = read("src/components/site/site.module.css");
    const rule = /\.accountName\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toContain("text-overflow: ellipsis");
    expect(rule).toContain("white-space: nowrap");
    expect(rule).toContain("overflow: hidden");
  });

  it("names the logo link, and hides the logo art inside it", () => {
    const html = shell(null);
    const link = /<a[^>]*aria-label="Trade Marketplace home"[^>]*>([\s\S]*?)<\/a>/.exec(html);
    expect(link?.[0]).toContain('href="/"');
    expect(link?.[1]).toMatch(/<svg[^>]*aria-hidden="true"/);
  });
});

describe("SiteShell (server)", () => {
  it("is signed out when nobody is signed in", async () => {
    expect(await siteViewer()).toBeNull();
  });

  it("reads the visitor from getViewer(), and passes only their first name and role on", async () => {
    signInAs(CUSTOMER);
    expect(await siteViewer()).toEqual(CUSTOMER);
    const html = renderToString(await SiteShell({ children: <p>child</p> }));
    expect(html).toContain("Aroha");
    expect(html).not.toContain("secret-email@example.nz");
    expect(html).not.toContain("user-1");
  });

  it("shows the signed-out links when the profile can't be read, instead of breaking the page", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getViewer).mockRejectedValue(new Error("database blip"));
    expect(await siteViewer()).toBeNull();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("wraps every page in the (site) group", async () => {
    signInAs(TRADIE);
    const { prelude } = await prerender(<SiteLayout><p>child</p></SiteLayout>);
    const html = await new Response(prelude).text();
    expect(html).toContain("<p>child</p>");
    expect(texts(html)).toContain("Find work");
  });
});

describe("SiteFooter", () => {
  it("lists every column with a heading and the year", () => {
    const html = renderToString(<SiteFooter year={2031} />);
    for (const column of FOOTER_COLUMNS) {
      expect(html).toContain(`>${column.title}</h2>`);
      for (const link of column.links) expect(html).toContain(`href="${link.href}"`);
    }
    expect(html).toContain("© 2031 Trade Marketplace");
  });
});

describe("customer colours on the public site", () => {
  const tokens = parseTokens(read("src/styles/tokens.css"));
  const rootValue = Object.fromEntries(tokens.sections.flatMap((s) => s.tokens.map((t) => [t.name, t.value])));
  const modeTokens = tokens.sections.find((s) => s.title.startsWith("Mode"))!.tokens.map((t) => t.name);
  const shellRule = /\.shell\s*\{([^}]*)\}/.exec(read("src/components/site/site.module.css"))![1];
  const declared = Object.fromEntries(
    [...shellRule.matchAll(/(--trade-[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
  );

  /** A token's value with var(--x) references followed, e.g. var(--trade-leaf) → #6cbd45. */
  const resolve = (value: string): string =>
    value.replace(/var\((--trade-[\w-]+)\)/g, (_, name: string) => resolve(rootValue[name]));
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(" ");

  it("resets every mode token, so a signed-in tradie or office user still sees the green site", () => {
    expect(Object.keys(declared).filter((n) => modeTokens.includes(n)).sort()).toEqual([...modeTokens].sort());
  });

  it("uses the same colours as :root's customer mode", () => {
    for (const name of modeTokens) {
      const ours = resolve(declared[name]);
      const want = resolve(rootValue[name]);
      const mix = /color-mix\(in srgb, (#\w+) (\d+)%, transparent\)/.exec(ours);
      if (mix) expect(want, name).toBe(`rgb(${rgb(mix[1])} / ${mix[2]}%)`);
      else expect(ours.toLowerCase(), name).toBe(want.toLowerCase());
    }
  });
});

describe("Wordmark", () => {
  it("draws the paths of docs/design/brand/wordmark.svg", () => {
    const brand = [...read("docs/design/brand/wordmark.svg").matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((m) => m[1]);
    const ours = [...renderToString(<Wordmark />).matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((m) => m[1]);
    expect(ours.sort()).toEqual(brand.sort());
  });

  it("is a named image by default, or hidden when the text next to it says the name", () => {
    expect(renderToString(<Wordmark />)).toMatch(/<svg[^>]*role="img"[^>]*aria-label="Trade Marketplace"/);
    expect(renderToString(<Wordmark label={null} />)).toMatch(/<svg[^>]*aria-hidden="true"/);
  });
});
