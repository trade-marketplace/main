import { expect, test } from "@playwright/test";

import { expectNoA11yViolations } from "./support/a11y";

// Proves the axe helper really fails a test, so a green home-page check means something.
// These pages are built in the test; they never touch the app.

const broken = `<!doctype html><html lang="en"><head><title>Broken</title></head><body><main>
  <h1>Broken page</h1>
  <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">
  <button></button>
</main></body></html>`;

test("fails on a page with violations, naming each rule", async ({ page }) => {
  await page.setContent(broken);
  let message = "";
  try {
    await expectNoA11yViolations(page);
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  expect(message).toContain("image-alt");
  expect(message).toContain("button-name");
});

test("passes on a clean page", async ({ page }) => {
  await page.setContent(
    `<!doctype html><html lang="en"><head><title>Clean</title></head><body><main><h1>Clean page</h1></main></body></html>`,
  );
  await expectNoA11yViolations(page);
});

test("can skip a rule when a reason is given", async ({ page }) => {
  await page.setContent(broken);
  await expectNoA11yViolations(page, {
    disableRules: [
      { id: "image-alt", reason: "test of the option itself" },
      { id: "button-name", reason: "test of the option itself" },
    ],
  });
});
