import { mkdir } from "node:fs/promises";
import path from "node:path";

import { expect, type Page, test } from "@playwright/test";

import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

const devUrl = process.env.E2E_DEV_BASE_URL;
const url = (query = "") => devUrl ? new URL(`/dev/components/fields${query}`, devUrl).href : "";

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => {
    const spilled = [...document.querySelectorAll<HTMLElement>("main label, main legend, main p, main button")]
      .filter((element) => element.scrollWidth > element.clientWidth + 1)
      .map((element) => element.textContent?.slice(0, 60));
    return { page: document.documentElement.scrollWidth - document.documentElement.clientWidth, spilled };
  })).toEqual({ page: 0, spilled: [] });
}

async function screenshot(page: Page, name: string) {
  const directory = process.env.FORM_FIELD_SCREENSHOTS_DIR;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(directory, `${name}.png`), fullPage: true, animations: "disabled" });
}

test("/dev/components/fields is a 404 in production", async ({ page }) => {
  test.skip(Boolean(devUrl), "checking the dev server instead");
  expect((await page.goto("/dev/components/fields"))?.status()).toBe(404);
});

test.describe("form fields on the dev server", () => {
  test.skip(!devUrl, "set E2E_DEV_BASE_URL to a running npm run dev");
  for (const viewport of VIEWPORTS) {
    test(`fits at ${viewport.width}px, with no accessibility violations`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto(url());
      await expect(page.getByRole("heading", { level: 1, name: "Form fields" })).toBeVisible();
      await noOverflow(page);
      await expectNoA11yViolations(page);
    });
  }

  for (const mode of ["customer", "trade", "office"]) {
    for (const state of ["default", "error", "disabled", "success"]) {
      for (const width of [390, 1440]) {
        test(`${mode}, ${state}, ${width}px: all variants, states and review screenshot`, async ({ page }) => {
          await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
          await page.goto(url(`?mode=${mode}&state=${state}`));
          await expect(page.getByRole("radio", { name: state[0].toUpperCase() + state.slice(1), exact: true })).toBeChecked();
          await noOverflow(page);
          await expectNoA11yViolations(page);
          await screenshot(page, `${mode}-${state}-${width}`);
        });
      }
    }
  }

  test("200% zoom and long content wrap without overflow", async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 450 });
    await page.goto(url());
    await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    await noOverflow(page);
    await expectNoA11yViolations(page);
    await screenshot(page, "zoom-200");
  });

  test("password visibility works with the keyboard and doesn't change or submit the value", async ({ page }) => {
    await page.goto(url());
    const password = page.getByLabel("Password", { exact: true });
    await password.fill("ExamplePassword123!");
    await password.press("Tab");
    const show = page.getByRole("button", { name: "Show password", exact: true });
    await expect(show).toBeFocused();
    await show.press("Space");
    await expect(password).toHaveAttribute("type", "text");
    await expect(password).toHaveValue("ExamplePassword123!");
    await page.getByRole("button", { name: "Hide password", exact: true }).press("Space");
    await expect(password).toHaveAttribute("type", "password");
  });

  test("keyboard focus has a visible 2px ring on text and choice controls", async ({ page }) => {
    await page.goto(url());
    const name = page.getByLabel("Full name", { exact: true });
    await name.focus();
    expect(await name.evaluate((element) => {
      const style = getComputedStyle(element.parentElement!);
      return { width: style.outlineWidth, style: style.outlineStyle };
    })).toEqual({ width: "2px", style: "solid" });
    const remember = page.getByRole("checkbox", { name: "Keep me logged in", exact: true });
    await remember.focus();
    expect(await remember.evaluate((element) => {
      const style = getComputedStyle(element.nextElementSibling!);
      return { width: style.outlineWidth, style: style.outlineStyle };
    })).toEqual({ width: "2px", style: "solid" });
    await screenshot(page, "keyboard-focus");
  });

  test("native numbers, decimal money strings, dates, select values and textarea counters stay editable", async ({ page }) => {
    await page.goto(url());
    await page.getByLabel("Hours", { exact: true }).fill("2.5");
    await page.getByLabel("Materials (NZD)", { exact: true }).fill("12.50");
    await page.getByLabel("Preferred date", { exact: true }).fill("2026-11-04");
    await page.getByLabel("Trade (required)", { exact: true }).selectOption("other");
    const area = page.getByLabel("Tell us about the job", { exact: true });
    await area.fill("Fix my fence");
    await expect(page.getByText("12 / 500 characters", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Materials (NZD)", { exact: true })).toHaveValue("12.50");
    await expect(page.getByLabel("Preferred date", { exact: true })).toHaveValue("2026-11-04");
    await expect(page.getByLabel("Hours", { exact: true })).toHaveValue("2.5");
    await expect(page.getByLabel("Trade (required)", { exact: true })).toHaveValue("other");
  });

  test("radio arrows, checkbox Space, switches and single/multiple chips work without a pointer", async ({ page }) => {
    await page.goto(url());
    const home = page.getByRole("radio", { name: "My home", exact: false });
    await home.focus();
    await home.press("ArrowDown");
    await expect(page.getByRole("radio", { name: "A rental property", exact: true })).toBeChecked();
    const remember = page.getByRole("checkbox", { name: "Keep me logged in", exact: true });
    await remember.focus(); await remember.press("Space"); await expect(remember).not.toBeChecked();
    const available = page.getByRole("switch", { name: "Available for new jobs", exact: true });
    await available.focus(); await available.press("Space"); await expect(available).not.toBeChecked();
    const trade = page.getByRole("group", { name: "Pick one trade", exact: true });
    await trade.getByRole("radio", { name: "Electrical", exact: true }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(trade.getByRole("radio", { name: "Plumbing", exact: true })).toBeChecked();
    const tags = page.getByRole("group", { name: "Pick any that apply", exact: true });
    const outside = tags.getByRole("checkbox", { name: "Outside", exact: true });
    await outside.focus(); await outside.press("Space");
    await expect(outside).toBeChecked(); await expect(tags.getByRole("checkbox", { name: "Inside", exact: true })).toBeChecked();
    await expectNoA11yViolations(page);
  });

  test("Any time selects only available windows, supports individual toggles and clear, and submits native values", async ({ page }) => {
    await page.goto(url());
    const picker = page.getByRole("group", { name: "When are you free?", exact: true });
    await picker.getByRole("button", { name: "Any time", exact: true }).click();
    await expect(picker.getByText("20 time windows selected", { exact: true })).toBeVisible();
    await expect(picker.getByRole("checkbox", { name: "Mon 2 Nov, Morning", exact: true })).not.toBeChecked();
    const tuesday = picker.getByRole("checkbox", { name: "Tue 3 Nov, Afternoon", exact: true });
    await tuesday.focus(); await tuesday.press("Space");
    await expect(tuesday).not.toBeChecked();
    await expect(picker.getByText("19 time windows selected", { exact: true })).toBeVisible();
    await picker.getByRole("button", { name: "Clear selection", exact: true }).click();
    await expect(picker.getByText("0 time windows selected", { exact: true })).toBeVisible();
    await tuesday.focus(); await tuesday.press("Space");
    expect(await tuesday.inputValue()).toBe("2026-11-03:afternoon");
  });

  test("state changes preserve typed values, selected chips and time windows, and disabled controls cannot change", async ({ page }) => {
    await page.goto(url());
    await page.getByLabel("Full name", { exact: true }).fill("Wiremu Te Rangi-Hēnare");
    const states = page.getByRole("group", { name: "Preview state", exact: true });
    await states.getByRole("radio", { name: "Error", exact: true }).focus(); await page.keyboard.press("Space");
    await expect(page.getByLabel("Full name", { exact: true })).toHaveValue("Wiremu Te Rangi-Hēnare");
    await expect(page.getByLabel("Full name", { exact: true })).toHaveAttribute("aria-invalid", "true");
    await states.getByRole("radio", { name: "Disabled", exact: true }).focus(); await page.keyboard.press("Space");
    await expect(page.getByLabel("Full name", { exact: true })).toBeDisabled();
    await expect(page.getByRole("switch", { name: "Available for new jobs", exact: true })).toBeDisabled();
    await states.getByRole("radio", { name: "Default", exact: true }).focus(); await page.keyboard.press("Space");
    await expect(page.getByLabel("Full name", { exact: true })).toHaveValue("Wiremu Te Rangi-Hēnare");
    await expect(page.getByRole("checkbox", { name: "Tue 3 Nov, Afternoon", exact: true })).toBeChecked();
  });

  test("address keyboard selection, Escape, no results and offline fallback preserve the input", async ({ page }) => {
    await page.goto(url());
    const input = page.getByRole("combobox", { name: "Property address", exact: true });
    await input.fill("Demo");
    const options = page.getByRole("listbox", { name: "Property address suggestions" }).getByRole("option");
    await expect(options).toHaveCount(3);
    await input.press("ArrowDown"); await input.press("ArrowDown");
    const active = await input.getAttribute("aria-activedescendant");
    expect(active).toBeTruthy();
    await expect(page.locator(`[id="${active}"]`)).toHaveAttribute("aria-selected", "true");
    await screenshot(page, "address-keyboard");
    await input.press("Enter");
    await expect(input).toHaveValue("12 Demo Road, Windsor");
    await expect(input).toHaveAttribute("aria-expanded", "false");
    await input.fill("Demo"); await expect(options).toHaveCount(3);
    await input.press("Escape"); await expect(input).toHaveValue("Demo");
    await expect(input).toHaveAttribute("aria-expanded", "false");
    await input.fill("nowhere"); await expect(options).toHaveCount(0);
    await expect(input).toHaveValue("nowhere");
    await input.fill("offline");
    await expect(page.locator("#address").getByText("Address search is unavailable. You can type the address by hand.", { exact: true })).toHaveCount(2);
    await input.fill("An address typed by hand"); await expect(input).toHaveValue("An address typed by hand");
    await expectNoA11yViolations(page);
  });

  test("address pointer selection and Tab dismissal work without stealing focus", async ({ page }) => {
    await page.goto(url());
    const input = page.getByRole("combobox", { name: "Property address", exact: true });
    await input.fill("Demo");
    await page.getByRole("option", { name: "12 Demo Street, Gladstone", exact: false }).click();
    await expect(input).toHaveValue("12 Demo Street, Gladstone");
    await expect(input).toBeFocused();
    await input.fill("Demo"); await expect(page.getByRole("listbox", { name: "Property address suggestions" }).getByRole("option")).toHaveCount(3);
    await input.press("Tab"); await expect(input).toHaveAttribute("aria-expanded", "false");
  });

  for (const width of [390, 1440]) {
  test(`invalid submit at ${width}px focuses the first error, retains entries and recovers to success`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto(url());
    const form = page.getByRole("form", { name: "Form field usage example" });
    await form.getByLabel("Your name (required)", { exact: true }).fill("Wiremu");
    await form.getByLabel("Your email (required)", { exact: true }).fill("bad-email");
    await form.getByLabel("What needs doing? (required)", { exact: true }).fill("Fix the fence");
    await form.getByLabel("Type of job (required)", { exact: true }).selectOption("other");
    await form.getByRole("button", { name: "Check example", exact: true }).click();
    const email = form.getByLabel("Your email (required)", { exact: true });
    await expect(email).toBeFocused();
    await expect(email).toHaveAccessibleDescription("Add a valid email address.");
    await expect(form.getByLabel("Your name (required)", { exact: true })).toHaveValue("Wiremu");
    await expect(form.getByLabel("What needs doing? (required)", { exact: true })).toHaveValue("Fix the fence");
    await expect(form.getByLabel("Type of job (required)", { exact: true })).toHaveValue("other");
    await expectNoA11yViolations(page);
    await screenshot(page, `validation-error-${width}`);
    await email.fill("wiremu@example.co.nz");
    const access = form.getByRole("checkbox", { name: "I can provide access to the property (required)", exact: true });
    await access.focus(); await access.press("Space");
    await form.getByRole("button", { name: "Check example", exact: true }).click();
    await expect(form).toHaveAttribute("aria-busy", "true");
    await expect(form.getByRole("button", { name: "Check example", exact: false })).toHaveAttribute("aria-disabled", "true");
    await screenshot(page, `validation-loading-${width}`);
    await expect(form.getByText("All good. This example hasn’t sent or saved anything.", { exact: true })).toBeVisible();
    await expectNoA11yViolations(page);
    await screenshot(page, `validation-success-${width}`);
    await form.getByRole("button", { name: "Reset example", exact: true }).click();
    await expect(email).toHaveValue("");
    await expect(form.getByText("0 / 500 characters", { exact: true })).toBeVisible();
    await expect(access).not.toBeChecked();
  });
  }
});
