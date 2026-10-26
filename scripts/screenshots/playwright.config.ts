import { defineConfig } from "@playwright/test";

// The screenshot run for UI PRs (#90): `npx playwright test -c scripts/screenshots/playwright.config.ts`.
// The app must already be running on APP_URL (the workflow starts it, so a failed start fails with its log), and
// screenshots/plan.json must exist (`node scripts/ci/screenshots.mjs plan`). How it fits together: docs/TESTING.md.

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim() || undefined;

export default defineConfig({
  testDir: ".",
  testMatch: "capture.spec.ts",
  globalSetup: "./global-setup.ts",
  fullyParallel: true,
  workers: 2,
  retries: 0,
  timeout: 60_000,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  outputDir: "../../test-results/screenshots",
  use: {
    baseURL: process.env.APP_URL ?? "http://127.0.0.1:3100",
    browserName: "chromium",
    launchOptions: executablePath ? { executablePath } : {},
  },
});
