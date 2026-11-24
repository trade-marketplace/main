import { readFileSync, statSync } from "node:fs";
import { expect, test } from "@playwright/test";

import { symbolCandidates } from "../../scripts/brand/material-symbol-names.mjs";
import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

const preview = process.env.POSTED_PREVIEW_E2E_URL || "http://127.0.0.1:3101";
const iconPath = "/fonts/material-symbols/MaterialSymbolsRounded.woff2";
const url = new URL("/dev/tokens", preview).href;

test("every source ligature matches the full reference, outlined and filled", async ({ page }) => {
  await page.goto(url);
  const result = await page.evaluate(async ({ source, href, names }) => {
    const referenceBytes = Uint8Array.from(atob(source), (c) => c.charCodeAt(0));
    const appBytes = await (await fetch(href)).arrayBuffer();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 40;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    let recognised: string[] = [];
    const mismatched: string[] = [];
    const bookmarkInk: number[] = [];

    for (const fill of [0, 1]) {
      const settings = { variationSettings: `"FILL" ${fill}, "wght" 400, "GRAD" 0, "opsz" 24` };
      const original = new FontFace(`Reference${fill}`, referenceBytes, settings);
      const served = new FontFace(`Served${fill}`, appBytes, settings);
      for (const face of await Promise.all([original.load(), served.load()])) document.fonts.add(face);
      ctx.font = `32px ${original.family}`;
      // A supported name shapes into a single 1em symbol; an unknown name spells out multiple characters.
      recognised = names.filter((name) => name.length > 1 && Math.abs(ctx.measureText(name).width - 32) < 0.01);

      function raster(name: string, family: string) {
        ctx.font = `32px ${family}`;
        ctx.clearRect(0, 0, 40, 40);
        ctx.fillText(name, 3, 32);
        return ctx.getImageData(0, 0, 40, 40).data;
      }
      for (const name of recognised) {
        const expected = raster(name, original.family);
        const actual = raster(name, served.family);
        if (name === "bookmark") {
          bookmarkInk.push(actual.reduce((ink, channel, index) => ink + (index % 4 === 3 ? channel : 0), 0));
        }
        if (Math.abs(ctx.measureText(name).width - 32) > 0.01 || actual.some((value, i) => value !== expected[i])) {
          mismatched.push(`${name}, FILL=${fill}`);
        }
      }
    }
    return { recognised, mismatched, bookmarkInk };
  }, {
    source: readFileSync("docs/design/fonts/MaterialSymbolsRounded.woff2").toString("base64"),
    href: iconPath,
    names: symbolCandidates(),
  });

  // Include names supplied by a service-job tuple, a conditional, a map and a demo array.
  expect(result.recognised).toEqual(expect.arrayContaining(["heat_pump", "visibility_off", "handyman", "near_me"]));
  expect(result.mismatched).toEqual([]);
  expect(result.bookmarkInk[1]).toBeGreaterThan(result.bookmarkInk[0]);
});

for (const { width, height } of VIEWPORTS) {
  test(`cold icon preload, layout and font fallback at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto(url);
    const icons = page.getByRole("region", { name: "Icons · Material Symbols Rounded" });
    const search = icons.getByRole("img", { name: "search", exact: true });
    await page.evaluate(() => document.fonts.load('400 24px "Material Symbols Rounded"'));
    const preload = page.locator(`head link[rel="preload"][as="font"][href="${iconPath}"]`);
    await expect(preload).toHaveCount(1);
    await expect(preload).toHaveAttribute("fetchpriority", "auto");
    const loads = await page.evaluate((path) =>
      performance.getEntriesByName(new URL(path, location.href).href).map((entry) => {
        const resource = entry as PerformanceResourceTiming;
        return { body: resource.decodedBodySize, transfer: resource.transferSize };
      }), iconPath);
    expect(loads).toHaveLength(1);
    expect(loads[0].body).toBe(statSync(`public${iconPath}`).size);
    expect(loads[0].transfer).toBeGreaterThan(0);
    expect(loads[0].transfer).toBeLessThan(statSync("docs/design/fonts/MaterialSymbolsRounded.woff2").size / 10);
    const size = await search.boundingBox();
    expect(size!.width).toBeCloseTo(size!.height, 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    await expectNoA11yViolations(page, { include: "#icons" });

    await icons.getByRole("link", { name: "Simulate the icon font failing" }).click();
    await expect(icons.getByRole("link", { name: "Turn the icon font back on" })).toBeVisible();
    await expect(search).toBeVisible();
    await page.goBack();
    await expect(icons.getByRole("link", { name: "Simulate the icon font failing" })).toBeVisible();
  });
}
