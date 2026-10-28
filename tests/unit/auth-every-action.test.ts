import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// "Role checks on every server action, not just pages" (#101). Every export of a "use server" file must be built
// with withRole() (src/server/auth/guard.ts), unless it's one of the few actions a signed-out visitor needs.
// A new action that skips the check fails here.

const PUBLIC_ACTIONS: Record<string, string[]> = {
  // Signing up, logging in/out and signup suburb lookup must work before sign-in.
  "src/server/auth/actions.ts": ["signUpAction", "logInAction", "logInAgainAction", "logOutAction", "searchSignupAreasAction"],
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "generated" ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

/** Files whose first statement is the "use server" directive. */
function serverActionFiles(): string[] {
  return sourceFiles("src").filter((file) => /^\s*(\/\/[^\n]*\n|\s)*["']use server["']/.test(readFileSync(file, "utf8")));
}

describe("server actions", () => {
  it("finds the action files (so this test can't pass by finding nothing)", () => {
    expect(serverActionFiles()).toContain(path.join("src", "server", "auth", "actions.ts"));
  });

  it("are all wrapped in withRole(), apart from the public sign-in ones", () => {
    const problems: string[] = [];
    for (const file of serverActionFiles()) {
      const source = readFileSync(file, "utf8");
      const allowed = PUBLIC_ACTIONS[file.split(path.sep).join("/")] ?? [];
      for (const match of source.matchAll(/^export\s+(?:async\s+)?(?:function|const|let)\s+(\w+)(.*)$/gm)) {
        const [, name, rest] = match;
        if (allowed.includes(name)) continue;
        if (/^\s*=\s*withRole\(/.test(rest)) continue;
        problems.push(`${file}: ${name} must be \`export const ${name} = withRole([...roles], async (viewer, ...) => …)\``);
      }
      if (/^export\s+default/m.test(source)) problems.push(`${file}: use named exports built with withRole()`);
    }
    expect(problems).toEqual([]);
  });
});
