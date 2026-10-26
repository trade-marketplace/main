// The Motion rules (WEBAPP_SPEC "Motion", #73) checked against src/styles/motion.css itself:
// - only transform and opacity animate (plus clip-path for M09 and the panel height for M24);
// - prefers-reduced-motion turns every animation and transition into an instant change, the skeleton into
//   static grey;
// - the timings match the spec numbers the JavaScript uses.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { MOTION_MS } from "@/lib/motion/timings";

const root = new URL("../../", import.meta.url);
const read = (file: string) => readFileSync(new URL(file, root), "utf8");
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

const css = stripComments(read("src/styles/motion.css"));

/** The text inside the `{ … }` that starts at `open` (the index of the `{`). */
function blockAt(text: string, open: number): { inner: string; end: number } {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    if (text[i] === "}" && --depth === 0) return { inner: text.slice(open + 1, i), end: i + 1 };
  }
  throw new Error("unbalanced braces");
}

function atBlock(text: string, header: string) {
  const start = text.indexOf(header);
  if (start < 0) throw new Error(`${header} not found`);
  const { inner, end } = blockAt(text, text.indexOf("{", start));
  return { inner, start, end };
}

const reducedBlock = atBlock(css, "@media (prefers-reduced-motion: reduce)");
const reduced = reducedBlock.inner;

/** Every keyframes block: name and the properties it animates. */
function keyframes(text: string) {
  const found: { name: string; props: string[] }[] = [];
  const re = /@keyframes\s+([\w-]+)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const { inner } = blockAt(text, m.index + m[0].length - 1);
    const props = [...inner.matchAll(/([\w-]+)\s*:/g)].map((p) => p[1]);
    found.push({ name: m[1], props: [...new Set(props)] });
  }
  return found;
}

/** Plain rules outside the reduced-motion block (hover media query unwrapped), as selector + declarations. */
function rules(text: string) {
  let flat = text.slice(0, reducedBlock.start) + text.slice(reducedBlock.end);
  flat = flat.replace(/@keyframes\s+[\w-]+\s*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
  flat = flat.replace(/@media \(hover: hover\)\s*\{([\s\S]*?\})\s*\}/g, "$1");
  return [...flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selectors: m[1].split(",").map((s) => s.trim().replace(/\s+/g, " ")),
    body: m[2],
  }));
}

const allRules = rules(css);
const reducedSelectors = new Set(
  [...reduced.matchAll(/([^{}]+)\{[^{}]*\}/g)].flatMap((m) => m[1].split(",").map((s) => s.trim().replace(/\s+/g, " "))),
);

describe("motion.css: only transform and opacity animate", () => {
  const frames = keyframes(css);

  it("has the kit's keyframes (docs/design/web.css) under their kit names", () => {
    const names = frames.map((f) => f.name);
    for (const name of [
      "tm-rise", "tm-reveal", "tm-pop", "tm-spark", "tm-glow", "tm-wipe", "tm-drawer", "tm-dialog", "tm-toast",
      "tm-badge", "tm-drop", "tm-fill", "tm-shimmer", "tm-shimmer-gold",
    ]) {
      expect(names, name).toContain(name);
    }
    expect(new Set(names).size).toBe(names.length);
  });

  it("keyframes only change transform and opacity, plus clip-path for the M09 wipe", () => {
    for (const { name, props } of frames) {
      const allowed = name === "tm-wipe" ? ["clip-path"] : ["transform", "opacity"];
      expect(props.filter((p) => !allowed.includes(p)), name).toEqual([]);
    }
  });

  it("transitions only move transform or opacity, plus the M24 accordion height (grid rows)", () => {
    for (const { selectors, body } of allRules) {
      for (const decl of body.matchAll(/(?:^|;)\s*transition(?:-property)?\s*:\s*([^;]+)/g)) {
        const props = decl[1].split(",").map((part) => part.trim().split(/\s+/)[0]);
        const allowed = selectors.includes(".tm-accordion") ? ["grid-template-rows"] : ["transform", "opacity", "none"];
        expect(props.filter((p) => !allowed.includes(p)), selectors.join(", ")).toEqual([]);
      }
    }
  });

  it("never animates width, height, top or left anywhere in the app's CSS", () => {
    const appCss = ["src/styles/base.css", "src/app/dev/motion/motion.module.css", "src/app/dev/tokens/tokens.module.css"]
      .map((f) => stripComments(read(f)))
      .join("\n");
    for (const decl of (css + appCss).matchAll(/transition(?:-property)?\s*:\s*([^;}]+)/g)) {
      expect(decl[1], decl[0]).not.toMatch(/\b(width|height|top|left|all)\b/);
    }
  });

  it("uses tokens for colour: every colour is a var() or a mix of vars", () => {
    expect(css).not.toMatch(/rgb\(|hsl\(|#[0-9a-f]{3,8}\b/i);
  });
});

describe("motion.css: prefers-reduced-motion makes everything instant", () => {
  const animated = allRules.filter((r) => /(?:^|;)\s*animation(?:-name)?\s*:(?!\s*none)/.test(r.body));
  const transitioned = allRules.filter((r) => /(?:^|;)\s*transition\s*:(?!\s*none)/.test(r.body));

  it("finds the animated and transitioned rules to check", () => {
    expect(animated.length).toBeGreaterThan(30);
    expect(transitioned.length).toBeGreaterThan(10);
  });

  it("switches off every animation (the skeleton's 300ms wait isn't motion, so it stays)", () => {
    const missing = animated
      .flatMap((r) => r.selectors)
      .filter((s) => s !== ".tm-skel")
      .filter((s) => !reducedSelectors.has(s));
    expect(missing).toEqual([]);
    expect(reduced).toMatch(/\{\s*animation:\s*none !important;\s*\}/);
  });

  it("switches off every transition, so hover and state changes are instant", () => {
    const missing = transitioned.flatMap((r) => r.selectors).filter((s) => !reducedSelectors.has(s));
    expect(missing).toEqual([]);
    expect(reduced).toMatch(/\{\s*transition:\s*none !important;\s*\}/);
  });

  it("makes the skeleton static grey: no shimmer layer, the grey stays", () => {
    expect(reduced).toMatch(/\.tm-skel::after\s*\{\s*display:\s*none;\s*\}/);
    const skel = allRules.find((r) => r.selectors.includes(".tm-skel"));
    expect(skel?.body).toMatch(/background:\s*var\(--tm-skel-base\)/);
  });

  it("stops view transitions (M02) too", () => {
    expect(reducedSelectors.has("::view-transition-group(*)")).toBe(true);
  });

  it("loops (shimmer, glint, typing dots, urgent ring) can't flicker: they are turned off, not shortened", () => {
    for (const s of [".tm-skel::after", ".tm-glint::before", ".tm-typing > span", ".tm-ring-urgent"]) {
      expect(reducedSelectors.has(s), s).toBe(true);
    }
  });
});

describe("motion.css: timings match the spec numbers", () => {
  const rootBlock = atBlock(css, ":root").inner;
  const vars = Object.fromEntries(
    [...rootBlock.matchAll(/(--tm-[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
  );
  const ms = (name: string) => {
    const value = vars[name];
    expect(value, name).toMatch(/^\d+ms$/);
    return Number.parseInt(value, 10);
  };

  it("the CSS and the JavaScript use the same numbers", () => {
    const pairs: [string, number][] = [
      ["--tm-m01-stagger", MOTION_MS.m01Stagger],
      ["--tm-m02-fade", MOTION_MS.m02Fade],
      ["--tm-m03-lift", MOTION_MS.m03Lift],
      ["--tm-m03-zoom", MOTION_MS.m03Zoom],
      ["--tm-m07-reveal", MOTION_MS.m07Reveal],
      ["--tm-m07-step", MOTION_MS.m07Step],
      ["--tm-m08-suggest", MOTION_MS.m08Suggest],
      ["--tm-m09-wipe", MOTION_MS.m09Wipe],
      ["--tm-m09-count", MOTION_MS.m09Count],
      ["--tm-m09-step", MOTION_MS.m09Step],
      ["--tm-m10-pop", MOTION_MS.m10Pop],
      ["--tm-m10-total", MOTION_MS.m10Total],
      ["--tm-m11-line", MOTION_MS.m11Line],
      ["--tm-m13-out", MOTION_MS.m13Out],
      ["--tm-m14-life", MOTION_MS.m14Life],
      ["--tm-m15-delay", MOTION_MS.m15Delay],
      ["--tm-m15-loop", MOTION_MS.m15Loop],
      ["--tm-m15-swap", MOTION_MS.m15Swap],
      ["--tm-m19-bubble", MOTION_MS.m19Bubble],
      ["--tm-m20-badge", MOTION_MS.m20Badge],
      ["--tm-m21-step", MOTION_MS.m21Step],
      ["--tm-m23-save", MOTION_MS.m23Save],
      ["--tm-m27-loop", MOTION_MS.m27Loop],
    ];
    for (const [name, expected] of pairs) expect(ms(name), name).toBe(expected);
  });

  it("the shared durations are the tokens: 120 / 200 / 320ms", () => {
    const tokens = stripComments(read("src/styles/tokens.css"));
    expect(tokens).toContain(`--trade-dur-fast: ${MOTION_MS.fast}ms`);
    expect(tokens).toContain(`--trade-dur-base: ${MOTION_MS.base}ms`);
    expect(tokens).toContain(`--trade-dur-slow: ${MOTION_MS.slow}ms`);
  });

  it("the bolt flash fits in 600ms: sparks start after the pop begins and end with it", () => {
    expect(ms("--tm-m10-delay") + ms("--tm-m10-burst")).toBe(MOTION_MS.m10Total);
    expect(MOTION_MS.m10Pop).toBeLessThanOrEqual(MOTION_MS.m10Total);
  });

  it("the price reveal is about 1.1s: wipe, then count, then the ticks", () => {
    expect(MOTION_MS.m09Wipe + MOTION_MS.m09Count).toBe(1000);
  });

  it("nothing that blocks input runs over 400ms (drawer 320, dialog 200)", () => {
    expect(MOTION_MS.slow).toBeLessThanOrEqual(400);
    expect(MOTION_MS.base).toBeLessThanOrEqual(400);
  });
});

describe("the app loads motion.css once, for every page", () => {
  it("is imported by the root layout, after the tokens", () => {
    const layout = read("src/app/layout.tsx");
    const tokens = layout.indexOf('import "@/styles/tokens.css"');
    const motion = layout.indexOf('import "@/styles/motion.css"');
    expect(tokens).toBeGreaterThanOrEqual(0);
    expect(motion).toBeGreaterThan(tokens);
  });
});
