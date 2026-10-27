import { expect, test } from "@playwright/test";

import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

const devUrl = process.env.E2E_DEV_BASE_URL;
const url = (state = "ready") => new URL(`/dev/components/mapbox?state=${state}`, devUrl).href;

test("Mapbox preview is private in production", async ({ page }) => {
  test.skip(Boolean(devUrl), "checking a dev server");
  expect((await page.goto("/dev/components/mapbox"))?.status()).toBe(404);
});

test.describe("Mapbox provider", () => {
  test.skip(!devUrl, "set E2E_DEV_BASE_URL to a development server");
  for (const viewport of VIEWPORTS) {
    for (const state of ["ready", "missing-token", "loading", "error", "empty", "location-denied"]) {
      test(`${state} at ${viewport.width}px is accessible without sideways scroll`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.goto(url(state));
        if (state === "error" || state === "missing-token") await expect(page.getByText("Map unavailable. Showing jobs in a list.")).toBeVisible();
        else if (state === "loading") await expect(page.getByText("Loading map…")).toBeVisible();
        else if (state === "location-denied") await expect(page.getByText("Location unavailable. Showing the Invercargill work area.")).toBeVisible();
        else await expect(page.getByRole("button", { name: "Use my location" })).toBeEnabled();
        await page.waitForTimeout(400);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
        await expectNoA11yViolations(page);
      });
    }
  }

  test("missing token never requests Mapbox; rows still open a card and Escape returns focus", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (request) => { if (/mapbox\.com/.test(request.url())) requests.push(request.url()); });
    await page.goto(url("missing-token"));
    const row = page.getByRole("list", { name: "13 jobs nearby" }).getByRole("button", { name: /^Ready to claim: Sub wiring/ });
    await row.focus(); await page.keyboard.press("Enter");
    await expect(page.getByRole("article", { name: "Sub wiring" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(row).toBeFocused();
    await expect(page.getByRole("article", { name: "Sub wiring" })).toHaveCount(0);
    expect(requests).toEqual([]);
  });

  test("real provider adapter projects our pins, clusters close jobs and fits cluster bounds", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(url());
    const map = page.getByRole("region", { name: /^Map of/ });
    const cluster = map.getByRole("button", { name: /jobs here.*Zoom in to see them$/ }).first();
    await expect(cluster).toBeVisible();
    await cluster.focus(); await page.keyboard.press("Enter");
    const showAll = page.getByRole("button", { name: "Show all jobs" });
    await expect(showAll).toBeFocused();
    await showAll.click();
    await expect(showAll).toHaveCount(0);
    const row = page.getByRole("list", { name: /jobs in view/ }).getByRole("button", { name: /^Ready to claim: Sub wiring/ });
    const pin = map.getByRole("button", { name: /^Ready to claim: Sub wiring/ });
    // The selected row always gets its own pin, even where it was clustered before selection.
    await row.click();
    await expect(pin).toBeVisible();
    await expect(pin).toHaveClass(/is-hot/);
    await expect(page.getByRole("article", { name: "Sub wiring" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(row).toBeFocused();
  });

  test("denied permission recentres the full work area and keeps every job", async ({ page }) => {
    await page.goto(url("location-denied"));
    await expect(page.getByText("Location unavailable. Showing the Invercargill work area.")).toBeVisible();
    const bounds = await page.locator("[data-camera-bounds]").getAttribute("data-camera-bounds");
    const b = JSON.parse(bounds!);
    expect((b.north + b.south) / 2).toBeCloseTo(-46.4132, 4);
    expect((b.east + b.west) / 2).toBeCloseTo(168.3538, 4);
    await expect(page.getByRole("list", { name: "13 jobs in view" }).getByRole("button")).toHaveCount(13);
  });

  test("location success shows the dot; map is usable with keyboard zoom controls", async ({ page }) => {
    await page.goto(url());
    const locate = page.getByRole("button", { name: "Use my location" });
    await expect(locate).toBeEnabled(); await locate.focus(); await page.keyboard.press("Enter");
    await expect(page.getByRole("img", { name: "You are here" })).toBeVisible();
    await expect(page.getByText("Map centred on your location.")).toBeAttached();
    await page.getByRole("button", { name: "Zoom out", exact: true }).focus(); await page.keyboard.press("Enter");
    await expect(locate).toBeEnabled();
  });

  test("the live configuration falls back when no token is installed", async ({ page }) => {
    await page.goto(url("live"));
    await expect(page.getByText("Map unavailable. Showing jobs in a list.")).toBeVisible();
    await expect(page.getByRole("list", { name: "13 jobs nearby" }).getByRole("button")).toHaveCount(13);
  });

  test("pins stay inside the map after resizing and switching through fallback states", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(url());
    for (const width of [390, 1440, 320, 768]) {
      await page.setViewportSize({ width, height: 900 });
      await page.getByRole("link", { name: "Map failure" }).click();
      await expect(page.getByText("Map unavailable. Showing jobs in a list.")).toBeVisible();
      await page.getByRole("link", { name: "Jobs", exact: true }).click();
      await expect(page.getByRole("button", { name: "Use my location" })).toBeEnabled();
      const map = page.getByRole("region", { name: /^Map of/ });
      await expect(async () => {
        const outer = (await map.boundingBox())!;
        for (const pin of await map.locator("button[data-pin-kind]").all()) {
          const box = (await pin.boundingBox())!;
          expect(box.x).toBeGreaterThanOrEqual(outer.x);
          expect(box.x + box.width).toBeLessThanOrEqual(outer.x + outer.width);
          expect(box.y).toBeGreaterThanOrEqual(outer.y);
          expect(box.y + box.height).toBeLessThanOrEqual(outer.y + outer.height);
        }
      }).toPass();
    }
  });

  test("full-page captures never clamp clusters to a transient one-pixel map", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(url());
    await expect(page.getByRole("button", { name: "Use my location" })).toBeEnabled();
    const map = page.getByRole("region", { name: /^Map of/ });
    await map.evaluate((element) => {
      const target = element as HTMLElement & { capturePositions?: number[]; captureObserver?: MutationObserver };
      target.capturePositions = [];
      target.captureObserver = new MutationObserver(() => {
        target.querySelectorAll<HTMLElement>('[data-pin-kind="cluster"]').forEach((pin) => target.capturePositions!.push(parseFloat(pin.style.left)));
      });
      target.captureObserver.observe(target, { subtree: true, attributes: true, attributeFilter: ["style"] });
    });
    await page.screenshot({ fullPage: true, animations: "disabled" });
    const transientPositions = await map.evaluate((element) => {
      const target = element as HTMLElement & { capturePositions?: number[]; captureObserver?: MutationObserver };
      target.captureObserver?.disconnect();
      return target.capturePositions ?? [];
    });
    for (const x of transientPositions) expect(x).toBeGreaterThanOrEqual(19);
  });
});
