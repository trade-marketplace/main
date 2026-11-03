import { expect, test } from "@playwright/test";
import { DRAFT_STORAGE_KEY } from "../../src/lib/job-draft";
import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

const dev = process.env.E2E_DEV_BASE_URL;
test.use({ reducedMotion: "reduce" });

for (const source of ["/", "/services/electrical"]) test(`blocked session storage: ${source} location survives wizard navigation, refresh and exit`, async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => { Object.defineProperty(window, "sessionStorage", { configurable: true, get() { throw new Error("Storage blocked"); } }); });
  await page.goto(source); const form = page.getByRole("form", { name: "What needs doing?", exact: true });
  await form.getByRole("button", { name: /^Location:/ }).click(); const dialog = page.getByRole("dialog", { name: "Location", exact: true });
  await dialog.getByRole("combobox", { name: "Town or suburb", exact: true }).fill("Bluff"); await dialog.getByRole("button", { name: "Use location", exact: true }).click();
  await form.getByRole("textbox").fill("Check the lights and wiring upstairs."); await form.getByRole("button", { name: "Get a price", exact: true }).click();
  await expect(page).toHaveURL(/\/jobs\/new$/); const original = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), DRAFT_STORAGE_KEY);
  expect(original.locationHint).toEqual({ label: "Bluff", point: null }); expect(original.data).not.toHaveProperty("point"); expect(original.data).not.toHaveProperty("addressLine1");
  await page.getByRole("button", { name: "Next", exact: true }).click(); await expect(page.getByRole("heading", { name: "Photos", exact: true })).toBeVisible(); await page.reload();
  await expect(page.getByRole("heading", { name: "Photos", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Back", exact: true }).click(); await expect(page.getByRole("textbox", { name: "Describe the job", exact: true })).toHaveValue(original.description);
  await page.getByRole("button", { name: "Save & exit", exact: true }).click(); await expect(page).toHaveURL("/"); await page.goto("/jobs/new");
  await expect(page.getByRole("textbox", { name: "Describe the job", exact: true })).toHaveValue(original.description);
  const restored = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), DRAFT_STORAGE_KEY);
  expect(restored.locationHint).toEqual(original.locationHint); expect(restored.data.postKey).toBe(original.data.postKey);
});

test("a new homepage handoff edits the restored draft once and retains its key, photos and address", async ({ page }) => {
  await page.goto("/jobs/new"); await page.getByRole("textbox", { name: "Describe the job", exact: true }).fill("Fix the fence beside the garage.");
  await page.evaluate(key => { const draft = JSON.parse(localStorage.getItem(key)!); draft.data.photoPaths = ["private/retained.webp"]; draft.data.addressLine1 = "1 Example Street"; localStorage.setItem(key, JSON.stringify(draft)); }, DRAFT_STORAGE_KEY);
  await page.reload(); const original = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).data, DRAFT_STORAGE_KEY);
  await page.getByRole("button", { name: "Save & exit", exact: true }).click();
  const home = page.getByRole("form", { name: "What needs doing?", exact: true }); await home.getByRole("textbox").fill("Repair a leaking tap downstairs."); await home.getByRole("button", { name: "Get a price", exact: true }).click();
  await expect(page).toHaveURL(/\/jobs\/new$/); await expect(page.getByRole("textbox", { name: "Describe the job", exact: true })).toHaveValue("Repair a leaking tap downstairs.");
  await expect(page.getByRole("radio", { name: "Plumbing", exact: true })).toBeChecked();
  const handed = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), DRAFT_STORAGE_KEY);
  expect(handed).toMatchObject({ completedDescribe: false, data: { postKey: original.postKey, photoPaths: original.photoPaths, addressLine1: original.addressLine1 } });
  await page.getByRole("textbox", { name: "Describe the job", exact: true }).fill("Check the lights and wiring upstairs.");
  await page.getByRole("button", { name: "Next", exact: true }).click(); await expect(page.getByRole("heading", { name: "Photos", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Back", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Describe the job", exact: true })).toHaveValue("Check the lights and wiring upstairs."); await expect(page).toHaveURL(/\/jobs\/new$/); await page.reload();
  await expect(page.getByRole("textbox", { name: "Describe the job", exact: true })).toHaveValue("Check the lights and wiring upstairs.");
  await page.getByRole("button", { name: "Save & exit", exact: true }).click(); await page.getByRole("link", { name: "Construction", exact: true }).click();
  await expect(page).toHaveURL(/\/jobs\/new$/); await expect(page.getByRole("radio", { name: "Construction", exact: true })).toBeChecked();
  await expect(page.getByRole("heading", { name: "What needs doing?", exact: true })).toBeVisible(); await expectNoA11yViolations(page);
});

test("homepage free text keeps the type inferred as the description changes; explicit type stays manual", async ({ page }) => {
  await page.goto("/"); const form = page.getByRole("form", { name: "What needs doing?", exact: true });
  await form.getByRole("textbox", { name: "What needs doing?", exact: true }).fill("Fix the fence");
  await form.getByRole("button", { name: "Get a price", exact: true }).click();
  await expect(page.getByRole("radio", { name: "Construction", exact: true })).toBeChecked();
  await expect(page.getByText(/We guessed Construction/)).toBeVisible();
  await page.getByRole("textbox", { name: "Describe the job", exact: true }).fill("Repair a leaking tap");
  await expect(page.getByRole("radio", { name: "Plumbing", exact: true })).toBeChecked();
  await expect(page.getByText(/We guessed Plumbing/)).toBeVisible();
  await page.evaluate(() => localStorage.clear()); await page.goto("/jobs/new?description=Fix+the+fence&type=construction");
  await page.getByRole("textbox", { name: "Describe the job", exact: true }).fill("Repair a leaking tap");
  await expect(page.getByRole("radio", { name: "Construction", exact: true })).toBeChecked();
});

test("blocked storage allows in-memory Next/Back with truthful warning, then safely refuses guest exit until persisted", async ({ page }) => {
  await page.addInitScript(key => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(name, value) { if (name === key && !Reflect.get(window, "allowDraftStorage")) throw new DOMException("Storage blocked", "QuotaExceededError"); original.call(this, name, value); };
  }, DRAFT_STORAGE_KEY);
  await page.goto("/jobs/new"); await page.getByRole("textbox", { name: "Describe the job", exact: true }).fill("Repair a leaking tap downstairs.");
  await page.getByRole("button", { name: "Next", exact: true }).click(); await expect(page.getByRole("heading", { name: "Photos", exact: true })).toBeVisible();
  await expect(page.getByText("Couldn’t save.", { exact: true })).toBeVisible(); await expect(page.getByText("Draft saved", { exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Back", exact: true }).click(); await expect(page.getByRole("textbox", { name: "Describe the job", exact: true })).toHaveValue("Repair a leaking tap downstairs.");
  await page.getByRole("button", { name: "Save & exit", exact: true }).click(); await expect(page.getByRole("heading", { name: "What needs doing?", exact: true })).toBeVisible();
  await expect(page.getByText("Couldn’t save.", { exact: true })).toBeVisible();
  await page.evaluate(() => Reflect.set(window, "allowDraftStorage", true)); await page.getByRole("button", { name: "Save & exit", exact: true }).click(); await expect(page).toHaveURL("/");
  await page.goto("/jobs/new"); await expect(page.getByRole("textbox", { name: "Describe the job", exact: true })).toHaveValue("Repair a leaking tap downstairs.");
  await expectNoA11yViolations(page);
});

test("guest: shared validation → editable guess → Photos → Back → refresh → Save & exit → restore", async ({ page }) => {
  await page.goto("/jobs/new");
  await expect(page.getByRole("heading", { name: "What needs doing?" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Describe the job", exact: true })).toBeFocused();
  await expect(page.getByRole("textbox", { name: "Describe the job", exact: true })).toHaveAttribute("aria-invalid", "true");
  await page.getByRole("textbox", { name: "Describe the job", exact: true }).fill("Lights in the lounge keep flickering.");
  await expect(page.getByRole("radio", { name: "Electrical", exact: true })).toBeChecked();
  await page.getByRole("radio", { name: "Plumbing", exact: true }).check();
  await page.getByRole("textbox", { name: "Describe the job", exact: true }).fill("Lights and wiring in the lounge need checking.");
  await expect(page.getByRole("radio", { name: "Plumbing", exact: true })).toBeChecked();
  await page.getByRole("button", { name: "Next", exact: true }).press("Enter");
  await expect(page.getByRole("heading", { name: "Photos", exact: true })).toBeFocused();
  await expect(page.getByRole("complementary", { name: "Your job" })).toContainText("Lights and wiring");
  await page.getByRole("link", { name: /What needs doing/ }).click();
  await expect(page.getByRole("textbox", { name: "Describe the job", exact: true })).toHaveValue("Lights and wiring in the lounge need checking.");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("link", { name: "Back", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Describe the job", exact: true })).toHaveValue("Lights and wiring in the lounge need checking.");
  await page.reload();
  await expect(page.getByText("Draft restored", { exact: true })).toBeVisible();
  const key = await page.evaluate((storageKey) => JSON.parse(localStorage.getItem(storageKey)!).data.postKey, DRAFT_STORAGE_KEY);
  await page.evaluate(() => { Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false }); window.dispatchEvent(new Event("offline")); });
  await page.getByRole("button", { name: "Save & exit", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/jobs/new");
  await expect(page.getByRole("textbox", { name: "Describe the job", exact: true })).toHaveValue("Lights and wiring in the lounge need checking.");
  expect(await page.evaluate((storageKey) => JSON.parse(localStorage.getItem(storageKey)!).data.postKey, DRAFT_STORAGE_KEY)).toBe(key);
});

test("a Photos deep link waits for Next and then restores the completed step on refresh", async ({ page }) => {
  await page.goto("/jobs/new?step=photos&description=Lights+keep+flickering&type=electrical");
  await expect(page.getByRole("heading", { name: "What needs doing?", exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Describe the job", exact: true }).fill("Lights and wiring in the lounge need checking.");
  await expect(page.getByRole("heading", { name: "Photos", exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "What needs doing?", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Photos", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Photos", exact: true })).toBeVisible();
});

test("unfinished guest text survives refresh; Not sure selects Other and its prompt", async ({ page }) => {
  await page.goto("/jobs/new?description=Garden&type=other");
  await expect(page.getByRole("textbox", { name: "What do you need done?", exact: true })).toHaveValue("Garden");
  await page.getByRole("textbox", { name: "What do you need done?", exact: true }).fill("Mo");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "What do you need done?", exact: true })).toHaveValue("Mo");
  await page.getByRole("button", { name: "Not sure", exact: true }).click();
  await expect(page.getByRole("radio", { name: "Other (anything)", exact: true })).toBeChecked();
  await expect(page.getByText("Moving, cleaning, gardening, assembly or anything else? Pick Other.", { exact: true })).toBeVisible();
});

test.describe("guarded Describe previews", () => {
  test.skip(!dev, "requires the dev or screenshot-only server");
  for (const viewport of VIEWPORTS) {
    test(`${viewport.width}px: every state fits and passes axe`, async ({ page }) => {
      test.setTimeout(180_000); await page.setViewportSize(viewport);
      for (const state of ["empty", "describe", "other", "restored", "invalid", "saving", "loading", "save-error", "offline", "load-error", "photos"]) {
        await page.goto(new URL(`/dev/components/post-job?state=${state}`, dev).href);
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(state === "photos" ? "Photos" : "What needs doing?");
        if (state === "offline") await expect(page.getByRole("button", { name: "Next", exact: true })).toHaveAttribute("aria-disabled", "true");
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), state).toBe(0);
        await expectNoA11yViolations(page);
      }
    });
  }
});
