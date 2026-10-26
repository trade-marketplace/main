import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);
const read = (file: string) => readFileSync(new URL(file, root), "utf8");

// Claude Code creates agent worktrees (full copies of the repo) under `.claude/worktrees/`.
// They must never be linted, tested or committed as if they were repo files.
describe("Claude Code worktrees (.claude/)", () => {
  it("are ignored by ESLint", async () => {
    const eslint = new ESLint({ cwd: fileURLToPath(root) });
    expect(await eslint.isPathIgnored(".claude/worktrees/agent-x/src/app/page.tsx")).toBe(true);
    expect(await eslint.isPathIgnored(".claude/settings.ts")).toBe(true);
    // Sanity check: real source is still linted.
    expect(await eslint.isPathIgnored("src/app/page.tsx")).toBe(false);
  }, 30_000);

  it("are git-ignored", () => {
    expect(read(".gitignore")).toMatch(/^\.claude\/worktrees\/$/m);
  });
});
