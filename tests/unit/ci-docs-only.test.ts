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

/** The job's steps in order, each as its name and its own lines (no YAML parser needed for this flat list). */
function workflowSteps(workflow: string) {
  return workflow
    .split(/^ {6}- name: /m)
    .slice(1)
    .map((chunk) => {
      const [name, ...rest] = chunk.split("\n");
      return { name: name.trim(), body: rest.join("\n") };
    });
}

describe("CI end-to-end and accessibility step (#287)", () => {
  const workflow = readFileSync(new URL(".github/workflows/ci.yml", root), "utf8");
  const steps = workflowSteps(workflow);
  const names = steps.map((step) => step.name);
  const step = (name: string) => {
    const found = steps.find((s) => s.name === name);
    if (!found) throw new Error(`No step named "${name}" in ci.yml. Steps: ${names.join(", ")}`);
    return found;
  };

  it("installs the browser and runs e2e after Build, then reports, in that order", () => {
    const order = [
      "Build",
      "Find Playwright version",
      "Cache Playwright browser",
      "Install Playwright browser",
      "End-to-end and accessibility",
      "Upload Playwright report",
      "Summary",
    ];
    const positions = order.map((name) => names.indexOf(name));
    expect(positions, names.join(", ")).not.toContain(-1);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("reuses the build instead of building again", () => {
    const e2e = step("End-to-end and accessibility").body;
    expect(e2e).toContain("run: npx playwright test");
    // `npm run e2e` runs `npm run build` first, which would build the app twice.
    expect(workflow).not.toMatch(/^\s*(?:run: )?npm run e2e/m);
  });

  it("only runs e2e when the build passed, so a docs-only PR (Build skipped) skips it too", () => {
    expect(step("Find Playwright version").body).toContain("steps.build.outcome == 'success'");
    expect(step("Cache Playwright browser").body).toContain("steps.playwright.outcome == 'success'");
    expect(step("Install Playwright browser").body).toContain("steps.playwright.outcome == 'success'");
    expect(step("End-to-end and accessibility").body).toContain("steps.browsers.outcome == 'success'");
    // Build itself only runs after a real install, which the docs-only check skips.
    expect(step("Build").body).toContain("steps.install.outcome == 'success'");
    expect(step("Install").body).toContain("steps.changes.outputs.docs_only != 'true'");
  });

  it("caches the browser per @playwright/test version and installs only Chromium", () => {
    expect(step("Find Playwright version").body).toContain("require('@playwright/test/package.json').version");
    const cache = step("Cache Playwright browser").body;
    expect(cache).toMatch(/uses: actions\/cache@v\d+/);
    expect(cache).toContain("path: ~/.cache/ms-playwright");
    expect(cache).toContain("${{ steps.playwright.outputs.version }}");
    const install = step("Install Playwright browser").body;
    expect(install).toContain("steps.browser-cache.outputs.cache-hit");
    expect(install).toContain("npx playwright install --with-deps chromium");
    expect(install).toContain("npx playwright install-deps chromium");
  });

  it("attaches the Playwright report for 7 days, only when e2e failed", () => {
    const upload = step("Upload Playwright report").body;
    expect(upload).toContain("steps.e2e.outcome == 'failure'");
    expect(upload).toMatch(/uses: actions\/upload-artifact@v\d+/);
    expect(upload).toContain("path: playwright-report/");
    expect(upload).toContain("retention-days: 7");
  });

  it("shows the e2e result in the run summary", () => {
    expect(step("Summary").body).toContain("${{ steps.e2e.outcome }}");
  });
});
