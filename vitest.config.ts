import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Printed here because Vitest hides output from a test file whose tests are all skipped.
if (!process.env.TEST_DATABASE_URL?.trim()) {
  console.warn(
    "Database tests will be skipped: set TEST_DATABASE_URL to a throwaway Postgres to run them (docs/TESTING.md).",
  );
}

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` throws outside a React Server Component; tests run plain Node.
      "server-only": fileURLToPath(new URL("./tests/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
