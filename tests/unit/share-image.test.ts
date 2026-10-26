import { describe, expect, it } from "vitest";

import * as forTradies from "@/app/for-tradies/opengraph-image";
import * as forTradiesTwitter from "@/app/for-tradies/twitter-image";
import * as home from "@/app/opengraph-image";
import * as homeTwitter from "@/app/twitter-image";

import { pngInfo } from "../support/png";

// Drawing a share image takes a second or two (Satori + resvg), so each is drawn once.
describe("share images", () => {
  it.each([
    ["home", home],
    ["for tradies", forTradies],
  ])("draws the %s image as a 1200 × 630 PNG", async (_name, route) => {
    expect(route.size).toEqual({ width: 1200, height: 630 });
    expect(route.contentType).toBe("image/png");
    expect(route.alt).toMatch(/^Trade Marketplace/);

    const response = await route.default();
    expect(response.headers.get("content-type")).toBe("image/png");
    const png = pngInfo(new Uint8Array(await response.arrayBuffer()));
    expect([png.width, png.height]).toEqual([1200, 630]);
  }, 30_000);

  it("uses the same picture and alt text for the Twitter card", () => {
    expect(homeTwitter.default).toBe(home.default);
    expect(homeTwitter.alt).toBe(home.alt);
    expect(forTradiesTwitter.default).toBe(forTradies.default);
    expect(forTradiesTwitter.size).toEqual(forTradies.size);
  });
});
