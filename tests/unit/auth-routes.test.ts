import { describe, expect, it } from "vitest";

import {
  afterLoginPath,
  decideRoute,
  HOME_BY_ROLE,
  homeForRole,
  loginPath,
  routeAccess,
  safeNextPath,
} from "@/lib/auth/routes";
import { ROLES } from "@/lib/mode";

const customer = { role: "CUSTOMER" } as const;
const tradie = { role: "TRADIE" } as const;
const office = { role: "ADMIN" } as const;

describe("homeForRole", () => {
  it("sends customers to /, tradies to /jobs and the office to /admin", () => {
    expect(homeForRole("CUSTOMER")).toBe("/");
    expect(homeForRole("TRADIE")).toBe("/jobs");
    expect(homeForRole("ADMIN")).toBe("/admin");
  });

  it("never redirects anyone away from their own home (no redirect loops)", () => {
    for (const role of ROLES) {
      expect(decideRoute(HOME_BY_ROLE[role], { role }), role).toEqual({ action: "allow" });
    }
  });
});

describe("decideRoute: signed out", () => {
  it("lets anyone open public pages", () => {
    for (const path of ["/how-it-works", "/help/paying", "/legal/privacy", "/tradies/abc", "/verify", "/recovery"]) {
      expect(decideRoute(path, null), path).toEqual({ action: "allow" });
    }
  });

  it("shows the landing page at /", () => {
    expect(decideRoute("/", null)).toEqual({ action: "allow" });
  });

  it("sends app pages to log in, remembering the page and its query", () => {
    expect(decideRoute("/dashboard", null)).toEqual({ action: "redirect", to: "/login?next=%2Fdashboard" });
    expect(decideRoute("/jobs", null, "/jobs?view=map")).toEqual({
      action: "redirect",
      to: "/login?next=%2Fjobs%3Fview%3Dmap",
    });
    expect(decideRoute("/admin/settings", null)).toEqual({
      action: "redirect",
      to: "/login?next=%2Fadmin%2Fsettings",
    });
  });

  it("can open log in and sign up", () => {
    expect(decideRoute("/login", null)).toEqual({ action: "allow" });
    expect(decideRoute("/signup/tradie", null)).toEqual({ action: "allow" });
  });
});

describe("decideRoute: wrong role", () => {
  it("redirects a tradie who opens a customer-only page to their home", () => {
    for (const path of ["/jobs/new", "/pay/p1", "/receipts/j1", "/profile/payments", "/jobs/j1/problem"]) {
      expect(decideRoute(path, tradie), path).toEqual({ action: "redirect", to: "/jobs" });
    }
  });

  it("redirects a customer who opens a tradie-only page to their home", () => {
    for (const path of ["/jobs", "/earnings", "/profile/payroll", "/jobs/j1/complete", "/quoting/apply"]) {
      expect(decideRoute(path, customer), path).toEqual({ action: "redirect", to: "/" });
    }
  });

  it("keeps customers and tradies out of the office", () => {
    expect(decideRoute("/admin", customer)).toEqual({ action: "redirect", to: "/" });
    expect(decideRoute("/admin/payouts", tradie)).toEqual({ action: "redirect", to: "/jobs" });
  });

  it("sends office users from customer and tradie pages to /admin", () => {
    expect(decideRoute("/dashboard", office)).toEqual({ action: "redirect", to: "/admin" });
    expect(decideRoute("/jobs/new", office)).toEqual({ action: "redirect", to: "/admin" });
  });
});

describe("decideRoute: right role", () => {
  it("lets both sides open shared pages", () => {
    for (const path of ["/jobs/j1", "/dashboard", "/messages", "/profile", "/profile/security"]) {
      expect(decideRoute(path, customer), path).toEqual({ action: "allow" });
      expect(decideRoute(path, tradie), path).toEqual({ action: "allow" });
    }
  });

  it("lets each role open its own pages", () => {
    expect(decideRoute("/jobs/new", customer)).toEqual({ action: "allow" });
    expect(decideRoute("/jobs/j1/book", tradie)).toEqual({ action: "allow" });
    expect(decideRoute("/admin/jobs/j1/price", office)).toEqual({ action: "allow" });
  });

  it("sends signed-in tradies and office users from the landing page to their home", () => {
    expect(decideRoute("/", customer)).toEqual({ action: "allow" });
    expect(decideRoute("/", tradie)).toEqual({ action: "redirect", to: "/jobs" });
    expect(decideRoute("/", office)).toEqual({ action: "redirect", to: "/admin" });
  });

  it("sends anyone already signed in from log in and sign up to their home", () => {
    expect(decideRoute("/login", customer)).toEqual({ action: "redirect", to: "/" });
    expect(decideRoute("/signup", tradie)).toEqual({ action: "redirect", to: "/jobs" });
  });
});

describe("routeAccess", () => {
  it("ignores a trailing slash", () => {
    expect(routeAccess("/admin/")).toEqual(routeAccess("/admin"));
    expect(routeAccess("/jobs/")).toEqual(routeAccess("/jobs"));
  });

  it("doesn't mistake look-alike paths for protected ones", () => {
    expect(routeAccess("/administrator")).toEqual({ kind: "public" });
    expect(routeAccess("/jobsearch")).toEqual({ kind: "public" });
    expect(routeAccess("/login/2fa")).toEqual({ kind: "public" });
  });
});

describe("safeNextPath", () => {
  it("keeps a path on this site, with its query", () => {
    expect(safeNextPath("/jobs/j1?tab=photos")).toBe("/jobs/j1?tab=photos");
  });

  it("refuses anything that could leave the site", () => {
    for (const next of [
      "https://evil.example",
      "//evil.example/path",
      "/\\evil.example",
      "\\\\evil.example",
      "/\tevil",
      "javascript:alert(1)",
      "",
      null,
      undefined,
    ]) {
      expect(safeNextPath(next), String(next)).toBeNull();
    }
  });
});

describe("loginPath", () => {
  it("is plain /login without a useful page to return to", () => {
    expect(loginPath()).toBe("/login");
    expect(loginPath("/")).toBe("/login");
    expect(loginPath("https://evil.example")).toBe("/login");
  });
});

describe("afterLoginPath", () => {
  it("returns to the page they came from when their role may open it", () => {
    expect(afterLoginPath("CUSTOMER", "/jobs/new")).toBe("/jobs/new");
  });

  it("goes to their home when there's no next page, it's unsafe, or it isn't theirs", () => {
    expect(afterLoginPath("TRADIE", null)).toBe("/jobs");
    expect(afterLoginPath("CUSTOMER", "//evil.example")).toBe("/");
    expect(afterLoginPath("TRADIE", "/jobs/new")).toBe("/jobs");
    expect(afterLoginPath("ADMIN", "/login")).toBe("/admin");
  });
});
