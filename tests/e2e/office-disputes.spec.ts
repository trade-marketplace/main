import { expect, test } from "@playwright/test";

import { DISPUTE_PREVIEW_STATES } from "../../src/lib/office-disputes";
import { expectNoA11yViolations } from "./support/a11y";

// Cancellations and disputes (#172, F06) in every state, with a pretend server, on the test-only preview app
// (playwright.config.ts starts it on 3101 with the /dev pages on). The real pages are checked against the database
// in tests/unit/office-disputes-db.test.ts.
const preview = process.env.OFFICE_DISPUTES_PREVIEW_URL || process.env.POSTED_PREVIEW_E2E_URL || "http://127.0.0.1:3101";
const url = (state: string) => `${preview}/dev/components/office-disputes?state=${state}`;

test("the disputes preview stays a 404 in production", async ({ page }) => {
  expect((await page.goto("/dev/components/office-disputes?state=list"))?.status()).toBe(404);
});

for (const width of [320, 390, 768, 1024, 1440]) {
  test(`every disputes state at ${width}px: one heading, no sideways scroll, no axe violations`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const state of DISPUTE_PREVIEW_STATES) {
      await test.step(state, async () => {
        expect((await page.goto(url(state)))?.status()).toBe(200);
        if (state === "loading") await expect(page.getByRole("heading", { level: 1, name: "Loading cases" })).toBeAttached();
        else await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
        if (state === "partial-refund" || state === "refund-failed") await expect(page.getByRole("alertdialog", { name: "Cancel and refund" })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await expectNoA11yViolations(page);
      });
    }
  });
}

test("by keyboard: list → case, a part refund with a part payout, then back to the list", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(url("list"));
  await page.getByRole("link", { name: "Replace outdoor plug" }).press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: /Replace outdoor plug/ })).toBeVisible();

  const refund = page.getByRole("button", { name: "Cancel and refund" });
  await refund.press("Enter");
  const dialog = page.getByRole("alertdialog", { name: "Cancel and refund" });
  await expect(dialog.getByText("Sent to Stripe as a test refund. No real money moves until real payments are on.")).toBeVisible();
  // Esc closes it and focus goes back to the button that opened it.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(refund).toBeFocused();

  await refund.press("Enter");
  await dialog.getByLabel("Part refund").check();
  await dialog.getByLabel("Pay Jack for work done").check();
  // Each field is checked before anything is sent, and says what it needs.
  await dialog.getByRole("button", { name: "Cancel and refund" }).click();
  await expect(dialog.getByText("Enter an amount to refund, like 50.00.")).toBeVisible();
  await dialog.getByLabel("Amount to refund").fill("117");
  await dialog.getByRole("button", { name: "Cancel and refund" }).click();
  await expect(dialog.getByText("Enter the hours to pay, like 1.5.")).toBeVisible();
  await dialog.getByLabel("Hours to pay").fill("0.5");
  await dialog.getByRole("button", { name: "Cancel and refund" }).click();
  await expect(dialog.getByText("Add a note. It goes on the timeline.")).toBeVisible();
  await dialog.getByLabel("Note").fill("Half refunded: Jack had isolated the circuit.");
  await dialog.getByRole("button", { name: "Cancel and refund" }).press("Enter");
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Job cancelled and refunded.").first()).toBeVisible();
  await expect(page.getByText("Cancelled with a part refund · tradie paid for part")).toBeVisible();

  await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Cancellations & disputes" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Cancellations & disputes" })).toBeVisible();
});

test("a problem is resolved with a note, and the case then reads as resolved", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url("problem"));
  await page.getByRole("button", { name: "Resolve", exact: true }).click();
  const dialog = page.getByRole("alertdialog", { name: "Resolve problem" });
  await expect(dialog.getByLabel("No refund")).toBeChecked();
  await dialog.getByLabel("Note").fill("Aroha is going back on Thursday to replace the tap.");
  await dialog.getByRole("button", { name: "Resolve", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Problem resolved.").first()).toBeVisible();
  await expect(page.getByText(/Resolved by Matt Larsen/)).toBeVisible();
});

test("a refund Stripe refuses keeps the dialog, what was typed and the message", async ({ page }) => {
  await page.goto(url("refund-failed"));
  const dialog = page.getByRole("alertdialog", { name: "Cancel and refund" });
  await expect(dialog.getByRole("alert")).toContainText("Stripe didn’t make that refund. Nothing was changed.");
  await dialog.getByRole("button", { name: "Cancel and refund" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Stripe didn’t make that refund.");
  await expect(dialog.getByLabel("Note")).toHaveValue("Customer found someone else.");
});

test("offline: the decisions say why they can't be used", async ({ page }) => {
  await page.goto(url("offline"));
  await expect(page.getByRole("button", { name: "Cancel and refund" })).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByRole("button", { name: "Keep the job going" })).toHaveAttribute("aria-disabled", "true");
});
