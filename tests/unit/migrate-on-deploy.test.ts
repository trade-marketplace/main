import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { decide } from "../../scripts/migrate-on-deploy.mjs";

describe("migrate-on-deploy", () => {
  it("runs on a production deploy with a database", () => {
    expect(decide({ VERCEL_ENV: "production", DIRECT_URL: "postgresql://x" }).run).toBe(true);
  });

  it("never runs on preview deploys, even with a database (PR migrations aren't merged yet)", () => {
    expect(decide({ VERCEL_ENV: "preview", DIRECT_URL: "postgresql://x" }).run).toBe(false);
  });

  it("never runs locally or in CI (no VERCEL_ENV)", () => {
    expect(decide({ DIRECT_URL: "postgresql://x" }).run).toBe(false);
  });

  it("skips production when the database isn't connected", () => {
    expect(decide({ VERCEL_ENV: "production" }).run).toBe(false);
    expect(decide({ VERCEL_ENV: "production", DIRECT_URL: "  " }).run).toBe(false);
  });

  it("is wired into the Vercel build before next build", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.scripts["vercel-build"]).toBe("node scripts/migrate-on-deploy.mjs && npm run build");
  });
});
