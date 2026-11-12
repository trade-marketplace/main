import { defineConfig, devices } from "@playwright/test";

// Only this opt-in journey; its fixture owns its app/services, so no ordinary preview servers are needed.
export default defineConfig({
  testDir: "..", testMatch: "whole-flow-signed-in.spec.ts", workers: 1, retries: 0,
  outputDir: "../../../test-results/whole-flow", reporter: "list",
  use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:3140", screenshot: "only-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {} },
});
