import { defineConfig, devices } from "@playwright/test";

// End-to-end tests (`npm run e2e`). How to write them: docs/TESTING.md.
// `npm run e2e` builds the app first; Playwright then starts the built app with `next start` and tests it.

const PORT = 3100; // Not 3000, so it never clashes with `npm run dev`.
const baseURL = `http://127.0.0.1:${PORT}`;

// Only for machines with a browser installed somewhere else (e.g. a pre-installed Chromium).
// Normally unset: CI and most laptops use the browser from `npx playwright install chromium`.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim() || undefined;

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], launchOptions: executablePath ? { executablePath } : {} },
    },
  ],
  webServer: {
    command: `npm run start -- --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    env: {
      // Keep end-to-end tests away from the real Supabase project (docs/SERVICES.md): the app runs with the
      // database and Supabase off. Empty values win over .env.local. Test databases: docs/TESTING.md.
      DATABASE_URL: "",
      DIRECT_URL: "",
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
    },
  },
});
