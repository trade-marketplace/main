import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Matt (3 Nov): no stray fonts. Every font-family in the app comes from the tokens (Trade Display / Trade UI,
// Material Symbols for icons) or inherits. The guarded /dev preview pages may use monospace for code samples.
function files(dir: string, ext: RegExp): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return full.startsWith(path.join("src", "app", "dev")) ? [] : files(full, ext);
    return ext.test(entry.name) ? [full] : [];
  });
}

const ALLOWED = /^(var\(--trade-font-[a-z]+\)|inherit|'Material Symbols Rounded'.*|'Trade (UI|Display)'.*)$/;

describe("brand fonts", () => {
  it("every CSS font-family uses a token or inherits", () => {
    const bad: string[] = [];
    for (const file of files("src", /\.css$/)) {
      for (const match of readFileSync(file, "utf8").matchAll(/font-family\s*:\s*([^;}]+)/g)) {
        const value = match[1].trim();
        if (!ALLOWED.test(value)) bad.push(`${file}: ${value}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("no inline fontFamily outside the token-reading places", () => {
    const bad = files("src", /\.tsx?$/)
      .filter((file) => /fontFamily\s*:/.test(readFileSync(file, "utf8")))
      .filter((file) => !/(share-image|PayForm)\.tsx$/.test(file));
    expect(bad).toEqual([]);
  });

  it("form controls inherit the brand font", () => {
    expect(readFileSync("src/styles/base.css", "utf8")).toMatch(/button, input, select, textarea[^{]*\{[^}]*font: inherit/);
  });
});
