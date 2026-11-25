import { describe, expect, it } from "vitest";

import nextConfig from "../../next.config";
import { SECURITY_HEADERS } from "@/lib/security-headers";

// #220: every response carries the clickjacking, sniffing, referrer and HTTPS headers.

const byName = (headers: readonly { key: string; value: string }[]) => Object.fromEntries(headers.map(({ key, value }) => [key.toLowerCase(), value]));

describe("security headers", () => {
  it("next.config applies them to every path", async () => {
    const rules = await nextConfig.headers!();
    const all = rules.find(rule => rule.source === "/:path*");
    expect(all).toBeDefined();
    expect(byName(all!.headers)).toEqual(byName(SECURITY_HEADERS));
  });

  it("refuses framing by any other site, in old and new browsers", () => {
    const headers = byName(SECURITY_HEADERS);
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["x-frame-options"]).toBe("DENY");
  });

  it("blocks injected base tags, plugins and off-site form posts", () => {
    const policy = byName(SECURITY_HEADERS)["content-security-policy"];
    expect(policy).toContain("base-uri 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("form-action 'self'");
  });

  it("keeps browsers on HTTPS, stops type sniffing and trims referrers", () => {
    const headers = byName(SECURITY_HEADERS);
    expect(headers["strict-transport-security"]).toMatch(/^max-age=(\d+)$/);
    expect(Number(/max-age=(\d+)/.exec(headers["strict-transport-security"])![1])).toBeGreaterThanOrEqual(31_536_000);
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  });

  it("turns off the camera and microphone but keeps location for our own pages", () => {
    const policy = byName(SECURITY_HEADERS)["permissions-policy"];
    expect(policy).toContain("camera=()");
    expect(policy).toContain("microphone=()");
    expect(policy).toContain("geolocation=(self)");
  });
});
