import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { pngInfo } from "../support/png";

// Favicon, app icons, manifest, share images and robots.txt (#218). These are files, not screens, so they're
// checked once rather than at every width.

/** Fetch a URL from the page's <head> on this test server (absolute share-image URLs point at the real domain). */
async function fetchFromHead(request: APIRequestContext, href: string) {
  const url = new URL(href, "http://placeholder");
  const response = await request.get(`${url.pathname}${url.search}`);
  expect(response.status(), href).toBe(200);
  return response;
}

async function headHref(page: Page, selector: string): Promise<string> {
  const href = await page.locator(selector).getAttribute(selector.includes("meta") ? "content" : "href");
  expect(href, selector).toBeTruthy();
  return href!;
}

test.describe("icons and share images", () => {
  test("the SVG favicon is the bolt on Forest", async ({ page, request }) => {
    await page.goto("/");
    const href = await headHref(page, 'link[rel="icon"][type="image/svg+xml"]');
    expect(new URL(href, "http://x").pathname).toBe("/icon.svg");
    const response = await fetchFromHead(request, href);
    expect(response.headers()["content-type"]).toBe("image/svg+xml");
    expect(await response.text()).toMatch(/^<svg[\s\S]*<path[\s\S]*<path[\s\S]*<\/svg>\s*$/);
  });

  test("the PNG favicon is 32px and the apple-touch-icon 180px", async ({ page, request }) => {
    await page.goto("/");
    for (const [selector, size] of [
      ['link[rel="icon"][type="image/png"]', 32],
      ['link[rel="apple-touch-icon"]', 180],
    ] as const) {
      const href = await headHref(page, selector);
      await expect(page.locator(selector)).toHaveAttribute("sizes", `${size}x${size}`);
      const response = await fetchFromHead(request, href);
      expect(response.headers()["content-type"]).toBe("image/png");
      const png = pngInfo(await response.body());
      expect([png.width, png.height], selector).toEqual([size, size]);
    }
    expect(new URL(await headHref(page, 'link[rel="apple-touch-icon"]'), "http://x").pathname).toBe(
      "/apple-icon.png",
    );
  });

  test("the web app manifest is linked and its icons load at the sizes it lists", async ({ page, request }) => {
    await page.goto("/");
    const href = await headHref(page, 'link[rel="manifest"]');
    expect(href).toBe("/manifest.webmanifest");
    const response = await fetchFromHead(request, href);
    expect(response.headers()["content-type"]).toContain("application/manifest+json");
    const manifest = (await response.json()) as {
      name: string;
      short_name: string;
      icons: { src: string; sizes: string; type: string; purpose: string }[];
    };
    expect(manifest.name).toBe("Trade Marketplace");
    expect(manifest.short_name).toBe("TradeMkt");
    expect(manifest.icons.map((i) => i.purpose)).toEqual(["any", "any", "maskable"]);
    for (const icon of manifest.icons) {
      const iconResponse = await fetchFromHead(request, icon.src);
      expect(iconResponse.headers()["content-type"]).toBe(icon.type);
      const png = pngInfo(await iconResponse.body());
      expect(`${png.width}x${png.height}`, icon.src).toBe(icon.sizes);
    }
  });

  for (const path of ["/opengraph-image", "/twitter-image", "/for-tradies/opengraph-image"]) {
    test(`${path} is a 1200 × 630 PNG`, async ({ request }) => {
      const response = await request.get(path);
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toBe("image/png");
      const png = pngInfo(await response.body());
      expect([png.width, png.height]).toEqual([1200, 630]);
    });
  }

  test("the home page shares its image as Open Graph and a large Twitter card", async ({ page, request }) => {
    await page.goto("/");
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
    await expect(page.locator('meta[property="og:image:width"]')).toHaveAttribute("content", "1200");
    await expect(page.locator('meta[property="og:image:height"]')).toHaveAttribute("content", "630");
    await expect(page.locator('meta[property="og:image:alt"]')).toHaveAttribute("content", /Sorted in a flash/);
    for (const selector of ['meta[property="og:image"]', 'meta[name="twitter:image"]']) {
      const href = await headHref(page, selector);
      expect(new URL(href).protocol, "share images need absolute URLs").toBe("https:");
      const response = await fetchFromHead(request, href);
      expect(response.headers()["content-type"]).toBe("image/png");
    }
    // The home page is public: no noindex.
    await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
  });

  test("robots.txt keeps crawlers out of the private pages", async ({ request }) => {
    const response = await request.get("/robots.txt");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/plain");
    const text = await response.text();
    expect(text).toContain("Allow: /\n");
    for (const path of ["/jobs", "/dashboard", "/profile", "/admin", "/messages", "/notifications", "/pay", "/receipts"]) {
      expect(text).toContain(`Disallow: ${path}\n`);
    }
  });
});
