import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import robots from "@/app/robots";
import { routeAccess } from "@/lib/auth/routes";
import { PRIVATE_PATHS } from "@/lib/metadata";

const rules = robots().rules;
const rule = Array.isArray(rules) ? rules[0] : rules;
const disallow = [rule.disallow ?? []].flat();

/** What a crawler following robots.txt does: a Disallow line is a path prefix. */
const blocked = (path: string) => disallow.some((prefix) => path.startsWith(prefix));

/** Every page route in the design's sitemap, with [params] filled in: "/jobs/[id] (lead)" → "/jobs/x". */
function sitemapPaths(): string[] {
  const sitemap = JSON.parse(readFileSync(new URL("../../docs/design/sitemap.json", import.meta.url), "utf8")) as {
    pages: { route: string }[];
  };
  return [
    ...new Set(
      sitemap.pages
        .flatMap((p) => p.route.split(" + "))
        .map((r) => r.trim().split(/[\s?]/)[0])
        .filter((r) => r.startsWith("/"))
        .map((r) => r.replace(/\[[^\]]+\]/g, "x")),
    ),
  ];
}

describe("robots.txt", () => {
  it("lets crawlers in everywhere else", () => {
    expect(rule.userAgent).toBe("*");
    expect(rule.allow).toBe("/");
  });

  it("keeps crawlers out of every private area", () => {
    expect(disallow).toEqual([...PRIVATE_PATHS]);
    for (const path of ["/jobs", "/jobs/new", "/jobs/123", "/dashboard", "/profile/payroll", "/admin/jobs/1"]) {
      expect(blocked(path), path).toBe(true);
    }
    for (const path of ["/messages", "/notifications", "/pay/abc", "/receipts/42"]) {
      expect(blocked(path), path).toBe(true);
    }
  });

  it("blocks exactly the sitemap pages that need signing in, so it can't drift from the route rules", () => {
    const paths = sitemapPaths();
    expect(paths.length).toBeGreaterThan(50);
    for (const path of paths) {
      const signedInOnly = routeAccess(path).kind === "roles";
      expect(blocked(path), `${path} (${routeAccess(path).kind})`).toBe(signedInOnly);
    }
  });

  it("never blocks the public pages that have share images", () => {
    for (const path of ["/", "/for-tradies", "/services/electrical", "/how-it-works", "/tradies/x", "/help"]) {
      expect(blocked(path), path).toBe(false);
    }
  });
});
