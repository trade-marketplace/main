import { expect, type Page, test } from "@playwright/test";

import { expectNoA11yViolations } from "./support/a11y";
import { VIEWPORTS } from "./support/viewports";

// The office job admin view (#171) in every state, with a pretend server. It is reachable only through
// guardDevPage(), so run its browser checks against Next dev:
// E2E_DEV_BASE_URL=http://127.0.0.1:3000 npx playwright test tests/e2e/dev-office-job.spec.ts
const devUrl = process.env.E2E_DEV_BASE_URL;
const url = (query = "") => (devUrl ? new URL(`/dev/components/office-job${query}`, devUrl).href : "");
const heading = (page: Page) => page.getByRole("heading", { level: 1 });

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
}

test("/dev/components/office-job is a 404 in production", async ({ page }) => {
  test.skip(Boolean(devUrl), "checking the development server instead");
  const response = await page.goto("/dev/components/office-job");
  expect(response?.status()).toBe(404);
});

test.describe("/dev/components/office-job", () => {
  test.skip(!devUrl, "set E2E_DEV_BASE_URL to a running npx next dev server");
  test.use({ reducedMotion: "reduce" });

  for (const viewport of VIEWPORTS) {
    test(`${viewport.width}px: every state and dialog has no axe violations or sideways scroll`, async ({ browser }) => {
      test.setTimeout(240_000);
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, reducedMotion: "reduce" });
      const page = await context.newPage();
      const queries = [
        "",
        "?state=unpaid",
        "?state=no-tradie",
        "?state=cancelled",
        "?state=long-text",
        "?state=error",
        "?menu=open",
        ...["reassign", "refund", "price", "status", "cancel", "message"].map((dialog) => `?dialog=${dialog}`),
        "?dialog=cancel&failure=1",
        // The Materials card (#512).
        ...["auto", "check", "decided", "sent", "not-reported", "receipt-error"].map((state) => `?state=materials-${state}`),
        "?state=materials-check&materials=approve",
        "?state=materials-check&materials=change",
        "?state=materials-check&materials=change&failure=1",
      ];
      for (const query of queries) {
        await page.goto(url(query));
        if (query.includes("state=error")) await expect(page.getByRole("heading", { name: "Can’t load this job" })).toBeVisible();
        else await expect(heading(page)).toBeVisible();
        await noOverflow(page);
        await expectNoA11yViolations(page);
      }
      await context.close();
    });
  }

  test("by keyboard: Actions, a dialog with a required note, Esc returning focus, then confirming", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(url());
    const actions = page.getByRole("button", { name: "Actions" });
    await actions.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menuitem", { name: "Reassign tradie" })).toBeFocused();
    await expect(page.getByRole("menuitem", { name: /^Edit price/ })).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("End");
    await expect(page.getByRole("menuitem", { name: "Cancel job" })).toBeFocused();
    await page.keyboard.press("Enter");

    const dialog = page.getByRole("alertdialog", { name: "Cancel this job?" });
    await expect(dialog).toBeVisible();
    // The note is required: confirming without it says so and keeps the dialog open.
    await dialog.getByRole("button", { name: "Cancel job" }).click();
    await expect(dialog.getByText("Add a note. It goes on the timeline.")).toBeVisible();
    await expectNoA11yViolations(page);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(actions).toBeFocused();

    await actions.press("Enter");
    await page.getByRole("menuitem", { name: "Cancel job" }).click();
    await page.getByRole("alertdialog").getByLabel("Note").fill("Customer rang to cancel.");
    await page.getByRole("alertdialog").getByRole("button", { name: "Cancel job" }).click();
    await expect(page.getByRole("alertdialog")).toBeHidden();
    await expect(page.getByText("Job cancelled.").first()).toBeVisible();
  });

  test("materials (#512): Approve spend by keyboard, with a required note and Esc returning focus", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(url("?state=materials-check"));
    const card = page.getByRole("region", { name: "Materials" });
    await expect(card.getByText("The payout is held until you check the receipt.")).toBeVisible();
    await expect(card.getByText("“The merchant was out of the 15 mm valve, so I fitted the 20 mm kit with adaptors.”")).toBeVisible();
    await expect(card.getByRole("link", { name: /Open receipt/ })).toHaveAttribute("target", "_blank");
    const approve = card.getByRole("button", { name: "Approve spend" });
    await approve.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("alertdialog", { name: "Approve spend" });
    await expect(dialog.getByText("Jack Wilson is repaid the full $146.50 with their payout.")).toBeVisible();
    await dialog.getByRole("button", { name: "Approve spend" }).click();
    await expect(dialog.getByText("Add a note for the timeline.")).toBeVisible();
    await expectNoA11yViolations(page);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(approve).toBeFocused();
    await expect(approve).not.toHaveCSS("outline-style", "none");

    await page.keyboard.press("Enter");
    await dialog.getByLabel("Note").fill("Receipt matches the job.");
    await dialog.getByRole("button", { name: "Approve spend" }).press("Enter");
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Spend approved. $146.50 goes to payroll.").first()).toBeVisible();
  });

  test("materials (#512): Change amount checks the amount against the spend, by pointer", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(url("?state=materials-check"));
    await page.getByRole("button", { name: "Change amount" }).click();
    const dialog = page.getByRole("alertdialog", { name: "Change amount" });
    await dialog.getByLabel("Amount to repay").fill("200");
    await dialog.getByLabel("Note").fill("Part was for another job.");
    await dialog.getByRole("button", { name: "Save amount" }).click();
    await expect(dialog.getByText("Enter up to $146.50, the spend.")).toBeVisible();
    await dialog.getByLabel("Amount to repay").fill("135");
    await dialog.getByRole("button", { name: "Save amount" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Amount saved. $135.00 goes to payroll.").first()).toBeVisible();
    await noOverflow(page);
  });

  test("materials (#512): once checked or sent, the card says so", async ({ page }) => {
    await page.goto(url("?state=materials-decided"));
    await expect(page.getByText("$135.00 · amount changed")).toBeVisible();
    await expect(page.getByText("Amount changed by Matt", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "Change amount" })).toBeVisible();
    await page.goto(url("?state=materials-sent"));
    await expect(page.getByRole("region", { name: "Materials" }).getByText("Sent to payroll")).toBeVisible();
    await expect(page.getByRole("button", { name: "Change amount" })).toHaveCount(0);
  });

  test("refund: a part refund asks for an amount, and the record-only notice is shown", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(url("?dialog=refund"));
    const dialog = page.getByRole("alertdialog", { name: "Refund" });
    await expect(dialog.getByText("Sent to Stripe as a test refund. No real money moves until real payments are on.")).toBeVisible();
    await dialog.getByLabel("Part refund").check();
    await dialog.getByLabel("Note").fill("Goodwill.");
    await dialog.getByRole("button", { name: "Record refund" }).click();
    await expect(dialog.getByText("Enter an amount to refund, like 50.00.")).toBeVisible();
    await dialog.getByLabel("Amount to refund").fill("50");
    await dialog.getByRole("button", { name: "Record refund" }).click();
    await expect(page.getByText("Refund recorded.").first()).toBeVisible();
  });

  test("a failed save keeps the dialog and what was typed", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(url("?dialog=message&failure=1"));
    const dialog = page.getByRole("alertdialog", { name: "Message both" });
    await dialog.getByLabel("Message").fill("Kia ora both.");
    await dialog.getByRole("button", { name: "Send message" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Couldn’t save that. Nothing was changed. Try again.");
    await expect(dialog.getByLabel("Message")).toHaveValue("Kia ora both.");
  });
});
