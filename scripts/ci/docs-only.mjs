// Decides whether a pull request only touches docs, so CI can skip the heavy checks (#68).
//
// Used by .github/workflows/ci.yml:  git diff --name-only --no-renames A B | node scripts/ci/docs-only.mjs
// Prints `docs_only=true` or `docs_only=false` and, on GitHub Actions, writes the same line to $GITHUB_OUTPUT.
//
// When in doubt it answers false (run everything): a skipped check that should have run is far worse than a slow one.
// Plain Node, no dependencies, so it runs before `npm ci` on whatever Node the runner has.

import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// lint (`eslint .`) and typecheck (tsconfig `**/*.ts`, `**/*.mjs`) read these wherever they live, even under docs/.
const CODE_FILE = /\.(?:[cm]?[jt]sx?)$/i;

/**
 * Paths that no check reads. If the app or a test ever starts importing something from here
 * (e.g. `docs/design/tokens.css`), remove it from this list.
 */
const DOCS_PATHS = [
  /\.md$/i, // README, AGENTS, DECISIONS, BUSINESS_PLAN, docs/*.md, the PR template
  /^docs\//, // design spec: html, css, json, images, fonts
  /^\.github\/ISSUE_TEMPLATE\//,
  /^\.github\/CODEOWNERS$/,
  /^LICENSE(?:\.[a-z]+)?$/i,
];

/** True when no lint, typecheck, test or build input lives at this path. */
export function isDocsPath(path) {
  if (CODE_FILE.test(path)) return false;
  return DOCS_PATHS.some((pattern) => pattern.test(path));
}

/** True only when there is at least one changed file and every one of them is docs. */
export function isDocsOnly(paths) {
  const files = paths.map((p) => p.trim()).filter(Boolean);
  return files.length > 0 && files.every(isDocsPath);
}

function main() {
  const docsOnly = isDocsOnly(readFileSync(0, "utf8").split("\n"));
  const line = `docs_only=${docsOnly}`;
  console.log(line);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${line}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
