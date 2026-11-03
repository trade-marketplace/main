import { expect, test } from "@playwright/test";
import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

const devUrl = process.env.E2E_DEV_BASE_URL;
const url = (state = "all-checked") => new URL(`/dev/components/trades-licences?state=${state}`, devUrl).href;
const file = { name: "licence.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7 test licence") };

test("trades and licences require the worker's session and preserve the return path", async ({ page, request }) => {
  await page.goto("/profile/trades"); await expect(page).toHaveURL(/\/login\?next=%2Fprofile%2Ftrades$/);
  expect((await request.post("/api/profile/trades", { headers: { origin: "https://evil.test" } })).status()).toBe(403);
  expect((await request.get("/api/profile/trades/document?trade=ELECTRICAL")).status()).toBe(401);
});

test.describe("trades and licences previews", () => {
  test.skip(!devUrl, "The guarded preview needs E2E_DEV_BASE_URL.");
  for (const viewport of VIEWPORTS) {
    test(`${viewport.width}px: all states fit, expose their meaning and pass axe`, async ({ page }) => {
      test.setTimeout(120_000); await page.setViewportSize(viewport);
      for (const state of ["all-checked", "checking", "rejected", "expiring", "expired", "loading", "save-error", "offline", "add"]) {
        await page.goto(url(state)); await expect(page.getByRole("heading", { name: "Trades & licences", exact: true })).toBeVisible();
        if (state === "rejected") await expect(page.getByText("Licence photo was unreadable")).toBeVisible();
        if (state === "checking") await expect(page.getByText("Checking", { exact: true })).toBeVisible();
        if (state === "expiring") await expect(page.getByText(/your licence expires within 30 days/)).toBeVisible();
        if (state === "expired") await expect(page.getByText(/your licence has expired/)).toBeVisible();
        if (state === "save-error") await expect(page.getByText("Couldn’t save.", { exact: true })).toBeVisible();
        if (state === "offline") await expect(page.getByText("You’re offline. Anything you’ve typed is saved.", { exact: true })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), state).toBe(0);
        await expectNoA11yViolations(page);
      }
    });
  }
  test("View opens the real document endpoint in a new tab and keeps the settings page in place", async ({ page }) => {
    await page.goto(url());
    const popupEvent = page.waitForEvent("popup"); await page.getByRole("link", { name: "View Electrical licence" }).click();
    const popup = await popupEvent; await popup.waitForLoadState();
    await expect(popup).toHaveURL(/\/api\/profile\/trades\/document\?trade=ELECTRICAL$/);
    await expect(popup.locator("body")).toContainText("session-expired");
    await expect(page.getByRole("heading", { name: "Trades & licences", exact: true })).toBeVisible();
  });
  test("adding a trade validates each field, uploads a document, then shows Checking", async ({ page }) => {
    await page.goto(url()); await page.getByRole("button", { name: "Add a trade", exact: true }).click();
    await page.getByLabel("Trade", { exact: true }).selectOption("GAS");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Enter your number, for example PGDB 44120.")).toBeVisible();
    await page.getByLabel("Gas fitting licence number").fill("PGDB 44120");
    await page.getByLabel("Expiry date").fill("2027-03-31");
    await page.getByLabel("Licence document").setInputFiles(file);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("region", { name: "Gas fitting", exact: true }).getByText("Checking", { exact: true })).toBeVisible();
    await expect(page.getByText("Saved.", { exact: true })).toBeVisible(); await expectNoA11yViolations(page);
  });
  test("rejected licence replacement retains the reason until saved, then goes back for checking", async ({ page }) => {
    await page.goto(url("rejected")); await page.getByRole("button", { name: "Try again Plumbing licence" }).click();
    await expect(page.getByText("Licence photo was unreadable")).toBeVisible();
    await page.getByLabel("Licence document").setInputFiles(file); await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("region", { name: "Plumbing", exact: true }).getByText("Checking", { exact: true })).toBeVisible();
    await expect(page.getByText("Licence photo was unreadable")).toHaveCount(0);
  });
  test("offline and failed submissions keep typed values; keyboard cancel returns focus to the trigger", async ({ page }) => {
    await page.goto(url("offline")); await page.getByRole("button", { name: "Add a trade", exact: true }).click();
    await page.getByLabel("Trade", { exact: true }).selectOption("GAS"); await page.getByLabel("Gas fitting licence number").fill("PGDB 44120");
    await expect(page.getByRole("button", { name: "Save changes" })).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByLabel("Gas fitting licence number")).toHaveValue("PGDB 44120");
    await page.goto(url("save-error")); await page.getByLabel("Licence document").setInputFiles(file);
    await page.getByRole("button", { name: "Save changes" }).click(); await expect(page.getByLabel("Plumbing licence number")).toHaveValue("PGDB 98211");
    await expect(page.getByText("Couldn’t save.", { exact: true })).toBeVisible();
    await page.goto(url()); await page.getByRole("button", { name: "Add a trade", exact: true }).focus(); await page.keyboard.press("Enter");
    await expect(page.getByLabel("Trade", { exact: true })).toBeFocused();
    await page.getByRole("button", { name: "Cancel", exact: true }).focus(); await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Add a trade", exact: true })).toBeFocused();
  });
  test("a field correction reuses the selected file and staged upload in the mounted form", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 1000 });
    let grants = 0, uploads = 0, saves = 0; const finals: string[] = [];
    const storageUrl = new URL("/_test/licence-upload", devUrl).href;
    await page.route("**/api/profile/trades/upload", async route => { grants++; await route.fulfill({ json: { ok: true, path: "owned/staged-licence", url: storageUrl, expiresAt: Date.now() + 7_200_000 } }); });
    await page.route("**/_test/licence-upload", async route => { uploads++; await route.fulfill({ status: 200, body: "" }); });
    await page.route("**/api/profile/trades", async route => {
      finals.push(route.request().postData() ?? ""); saves++;
      if (saves === 1) await route.fulfill({ status: 400, json: { ok: false, error: "invalid", fields: { expiresOn: "Enter a current expiry date." } } });
      else await route.fulfill({ json: { ok: true, snapshot: { today: "2026-11-04", rows: [{ trade: "GAS", licence: { id: "gas", number: "PGDB 44120", status: "PENDING", expiresOn: "2028-03-31", rejectionReason: null, hasDocument: true } }] } } });
    });
    await page.goto(`${url()}&transport=network`); await page.getByRole("button", { name: "Add a trade", exact: true }).click();
    await page.getByLabel("Trade", { exact: true }).selectOption("GAS"); await page.getByLabel("Gas fitting licence number").fill("PGDB 44120");
    await page.getByLabel("Expiry date").fill("2027-03-31"); await page.getByLabel("Licence document").setInputFiles(file);
    await page.getByRole("button", { name: "Save changes" }).click(); await expect(page.getByText("Enter a current expiry date.")).toBeVisible();
    expect(await page.getByLabel("Licence document").evaluate(input => (input as HTMLInputElement).files?.[0]?.name)).toBe("licence.pdf");
    await page.getByLabel("Expiry date").fill("2028-03-31"); await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("region", { name: "Gas fitting", exact: true }).getByText("Checking", { exact: true })).toBeVisible();
    expect({ grants, uploads, saves }).toEqual({ grants: 1, uploads: 1, saves: 2 }); expect(finals.every(body => body.includes("owned/staged-licence"))).toBe(true);
    await expectNoA11yViolations(page);
  });

});
