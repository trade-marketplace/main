import path from "node:path";
import { defineConfig } from "@playwright/test";
import config from "../../playwright.config";

export default defineConfig({
  ...config,
  testDir: path.resolve("tests/e2e"),
  outputDir: path.resolve("test-results"),
  use: { ...config.use, baseURL: "http://127.0.0.1:3184" },
  webServer: [
    { ...config.webServer, command: "npm run start -- --port 3184", url: "http://127.0.0.1:3184" },
    { ...config.webServer, command: "npm run start -- --port 4284", url: "http://127.0.0.1:4284", env: {
      DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54336/postgres",
      DIRECT_URL: "postgresql://postgres:postgres@127.0.0.1:54336/postgres",
      NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "", SCREENSHOT_DEV_PAGES: "1",
    } },
  ],
});
