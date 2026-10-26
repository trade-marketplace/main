import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { isDocsOnly, isDocsPath } from "../../scripts/ci/docs-only.mjs";

const root = new URL("../../", import.meta.url);

describe("CI docs-only filter (#68)", () => {
  it("skips the heavy checks when a PR only changes docs", () => {
    expect(
      isDocsOnly([
        "README.md",
        "DECISIONS.md",
        "docs/SERVICES.md",
        "docs/design/tokens.css",
        "docs/design/pages.html",
        "docs/design/sitemap.json",
        "docs/design/img/hero.jpg",
        ".github/ISSUE_TEMPLATE/task.yml",
        ".github/pull_request_template.md",
        ".github/CODEOWNERS",
      ]),
    ).toBe(true);
  });

  it("runs everything when any changed file is code, config or the workflow itself", () => {
    for (const path of [
      "src/app/page.tsx",
      "tests/unit/env.test.ts",
      "package.json",
      "package-lock.json",
      ".nvmrc",
      ".npmrc",
      "prisma/schema.prisma",
      "next.config.ts",
      "eslint.config.mjs",
      "scripts/ci/docs-only.mjs",
      ".github/workflows/ci.yml",
      ".env.example",
    ]) {
      expect(isDocsOnly(["README.md", path]), path).toBe(false);
    }
  });

  it("treats script files under docs/ as code, because lint and typecheck read them", () => {
    expect(isDocsPath("docs/design/demo.js")).toBe(false);
    expect(isDocsPath("docs/plan/helper.ts")).toBe(false);
    expect(isDocsPath("docs/design/tokens.css")).toBe(true);
  });

  it("runs everything when it can't tell (no changed files)", () => {
    expect(isDocsOnly([])).toBe(false);
    expect(isDocsOnly(["", "  "])).toBe(false);
  });

  it("works as the command the workflow pipes `git diff` into", () => {
    const run = (input: string) =>
      execFileSync(process.execPath, ["scripts/ci/docs-only.mjs"], {
        cwd: root,
        input,
        env: { ...process.env, GITHUB_OUTPUT: "" },
      })
        .toString()
        .trim();
    expect(run("README.md\ndocs/SERVICES.md\n")).toBe("docs_only=true");
    expect(run("README.md\nsrc/app/page.tsx\n")).toBe("docs_only=false");
    expect(run("")).toBe("docs_only=false");
  });
});

describe("CI workflow (#68)", () => {
  const workflow = readFileSync(new URL(".github/workflows/ci.yml", root), "utf8");

  it("runs on pull requests and pushes to main", () => {
    expect(workflow).toMatch(/^ {2}pull_request:/m);
    expect(workflow).toMatch(/^ {2}push:\n {4}branches: \[main\]/m);
    // A workflow-level paths filter would leave a required check stuck on "waiting" for docs-only PRs.
    expect(workflow).not.toMatch(/paths(-ignore)?:/);
  });

  it("uses the pinned Node version and caches npm", () => {
    expect(workflow).toContain("node-version-file: .nvmrc");
    expect(workflow).toContain("cache: npm");
  });

  it("runs install and the four checks as separately named steps", () => {
    for (const command of ["npm ci", "npm run lint", "npm run typecheck", "npm test", "npm run build"]) {
      expect(workflow).toContain(`run: ${command}`);
    }
  });
});
