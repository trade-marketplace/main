import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { MOTION } from "@/lib/motion/catalogue";
import * as hooks from "@/lib/motion/hooks";
import * as helpers from "@/lib/motion/helpers";

const root = new URL("../../", import.meta.url);
const read = (file: string) => readFileSync(new URL(file, root), "utf8");

type SpecEntry = { id: string; name: string; what: string; timing: string; where: string };
const spec: SpecEntry[] = JSON.parse(read("docs/design/sitemap.json")).motion;
const motionCss = read("src/styles/motion.css");

// App code may not contain hex colours, so the catalogue names the token where the spec writes a hex.
const HEX_TO_TOKEN: Record<string, string> = { "#2163C6": "--trade-focus" };
const withTokens = (text: string) => text.replace(/#[0-9A-Fa-f]{6}\b/g, (hex) => HEX_TO_TOKEN[hex] ?? hex);

describe("the motion catalogue", () => {
  it("has M01–M27 in order", () => {
    expect(MOTION.map((m) => m.id)).toEqual(Array.from({ length: 27 }, (_, i) => `M${String(i + 1).padStart(2, "0")}`));
  });

  it("says exactly what docs/design/sitemap.json says (names, what happens, timing, where)", () => {
    expect(MOTION.map(({ id, name, what, timing, where }) => ({ id, name, what, timing, where }))).toEqual(
      spec.map((m) => ({ ...m, what: withTokens(m.what) })),
    );
  });

  it("matches the Motion table in WEBAPP_SPEC.md", () => {
    const table = read("docs/design/WEBAPP_SPEC.md");
    for (const m of spec) {
      expect(table, m.id).toContain(`| ${m.id} | ${m.name} | ${m.what} | ${m.timing} | ${m.where} |`);
    }
  });

  it("names an implementation for every animation, and every class it names exists in motion.css", () => {
    for (const m of MOTION) {
      expect(m.uses.length, m.id).toBeGreaterThan(0);
      for (const use of m.uses.filter((u) => u.startsWith("."))) {
        expect(motionCss, `${m.id} ${use}`).toMatch(new RegExp(`${use.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`));
      }
    }
  });

  it("every hook or helper it names is exported", () => {
    const exported = new Set([...Object.keys(hooks), ...Object.keys(helpers)]);
    for (const m of MOTION) {
      for (const use of m.uses.filter((u) => /^[a-z]\w*\(/.test(u))) {
        expect(exported.has(use.slice(0, use.indexOf("("))), `${m.id} ${use}`).toBe(true);
      }
    }
  });
});
