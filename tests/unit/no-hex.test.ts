// The "no hex colours outside the tokens file" rule (#72, AGENTS.md §5).
// It's a test rather than an ESLint/stylelint rule because one check then covers CSS, CSS modules, TS and TSX
// (inline styles, SVG fills, template strings) with no new dependencies, and it runs in `npm test` and CI.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { findHexInCss, findHexInScript } from "../find-hex";

const root = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(root, "src");
/** The one file allowed to contain hex values. */
const TOKENS_FILE = "src/styles/tokens.css";
const SKIP_DIRS = ["src/generated"];
const SCRIPT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

function appFiles(): string[] {
  return readdirSync(SRC, { recursive: true, encoding: "utf8" })
    .map((f) => path.posix.join("src", f.split(path.sep).join("/")))
    .filter((f) => !SKIP_DIRS.some((d) => f === d || f.startsWith(`${d}/`)))
    .filter((f) => f !== TOKENS_FILE && (f.endsWith(".css") || SCRIPT.test(f)));
}

describe("no hard-coded hex colours in app code", () => {
  it("finds the app files to check", () => {
    const files = appFiles();
    expect(files).toContain("src/app/layout.tsx");
    expect(files).toContain("src/styles/base.css");
    expect(files).not.toContain(TOKENS_FILE);
  });

  it("has no hex colour outside src/styles/tokens.css", () => {
    const problems = appFiles().flatMap((file) => {
      const text = readFileSync(path.join(root, file), "utf8");
      const hits = file.endsWith(".css") ? findHexInCss(text) : findHexInScript(text, file);
      return hits.map((h) => `${file}:${h.line} ${h.match}`);
    });
    expect(
      problems,
      `Use a token from ${TOKENS_FILE} (e.g. var(--trade-forest)) instead of a hex colour. New colour? Add a token (Matt reviews).`,
    ).toEqual([]);
  });
});

describe("the hex finder itself", () => {
  it("catches hex in CSS values but not in comments", () => {
    expect(findHexInCss(".a { color: #0c251d; }\n/* #ffffff and issue #101 */\n.b { fill: #FFF }")).toEqual([
      { line: 1, match: "#0c251d" },
      { line: 3, match: "#FFF" },
    ]);
  });

  it("catches hex in strings, template literals and JSX, but not in comments", () => {
    const source = [
      "// see #101 and #fff in a comment",
      'const a = "#0C251D";',
      "const b = `0 0 0 1px #abc`;",
      "const c = <svg><path fill=\"#A6D754\" /><p>#ffffff</p></svg>;",
      "/* #123456 */ const d = 'var(--trade-forest)';",
    ].join("\n");
    expect(findHexInScript(source, "x.tsx").map((h) => `${h.line} ${h.match}`)).toEqual([
      "2 #0C251D",
      "3 #abc",
      "4 #A6D754",
      "4 #ffffff",
    ]);
  });

  it("ignores things that only look a bit like hex", () => {
    expect(findHexInCss(".x { grid-area: a; } #main-nav { } .y { content: '#faq' }")).toEqual([]);
    expect(findHexInScript('const href = "#main"; const id = "#section-1";', "x.ts")).toEqual([]);
  });
});
