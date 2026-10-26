// Draws the favicon and app icons (#218, mockup `w-meta` in docs/design/pages.html): the bolt mark on Forest.
//
//   node scripts/brand/icons.mjs
//
// Run it again whenever the bolt (docs/design/brand/logo.svg) or the Forest / Lime tokens (src/styles/tokens.css)
// change, and commit what it writes. It needs Playwright's Chromium (`npx playwright install chromium`, or set
// PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) to turn the SVG into PNGs. tests/unit/brand-icons.test.ts fails if the
// committed SVG no longer matches the logo and tokens, or a PNG has the wrong size.
//
// Sizes and proportions follow the mockup: the bolt is ~55% of the icon's height on a square with ~22% rounded
// corners. Small sizes get a bigger bolt so it still reads in a 16px browser tab. Icons that the device masks
// itself (iOS home screen, Android's maskable icon) are full squares with no corners of their own.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const LOGO_FILE = "docs/design/brand/logo.svg";
export const TOKENS_FILE = "src/styles/tokens.css";

/** The bolt's drawing box, as the mockups use it: a hair bigger than logo.svg's 26×43 so no edge is clipped. */
const BOLT_BOX = { x: -0.2, y: -0.2, width: 26.2, height: 43.6 };
/** Every icon is drawn on this grid, then scaled. */
const GRID = 512;

/**
 * @typedef {{
 *   file: string,          // where it's written, from the repo root
 *   size: number | null,   // PNG width and height in px; null = SVG
 *   radius: number,        // corner radius as a share of the side (0 = full square for the device to mask)
 *   bolt: number,          // bolt height as a share of the side
 *   use: string,           // what it's for
 * }} IconSpec
 */

/** @type {readonly IconSpec[]} */
export const ICONS = [
  // Mockup "Browser tab": 16px square, 4px corners, 10px bolt. This is the file browsers show in the tab.
  { file: "src/app/icon.svg", size: null, radius: 4 / 16, bolt: 10 / 16, use: "favicon (SVG, browser tab)" },
  // Mockup "favicon 32": 7px corners, 17px bolt. For browsers without SVG favicons.
  { file: "src/app/icon.png", size: 32, radius: 7 / 32, bolt: 17 / 32, use: "favicon (32px PNG)" },
  // Mockup "apple-touch 180". iOS rounds the corners itself (and fills transparent ones black), so a full square.
  { file: "src/app/apple-icon.png", size: 180, radius: 0, bolt: 0.55, use: "apple-touch-icon" },
  // Mockup "PWA 512": 36/160 corners, 88/160 bolt. Used as-is on desktop installs, so it keeps its own corners.
  { file: "public/icons/icon-192.png", size: 192, radius: 36 / 160, bolt: 88 / 160, use: "PWA icon (any)" },
  { file: "public/icons/icon-512.png", size: 512, radius: 36 / 160, bolt: 88 / 160, use: "PWA icon (any)" },
  // Android crops a maskable icon to its own shape, keeping at least the middle 80% circle (the safe zone).
  // Full bleed, and the bolt is 0.55 × 0.8 = 44% so it looks the same size as on the other icons after cropping.
  { file: "public/icons/icon-maskable-512.png", size: 512, radius: 0, bolt: 0.44, use: "PWA icon (maskable)" },
];

/** The two bolt paths from docs/design/brand/logo.svg. */
export function boltPaths(logoSvg) {
  const paths = [...logoSvg.matchAll(/<path\b[^>]*\sd="([^"]+)"/g)].map((m) => m[1]);
  if (paths.length !== 2) throw new Error(`Expected the 2 bolt paths in ${LOGO_FILE}, found ${paths.length}.`);
  return paths;
}

/** A raw colour token from the `:root` block of src/styles/tokens.css, e.g. `rootColour(css, "forest")`. */
export function rootColour(css, name) {
  const root = /:root\s*\{([^}]*)\}/.exec(css.replace(/\/\*[\s\S]*?\*\//g, ""))?.[1] ?? "";
  const value = new RegExp(`--trade-${name}\\s*:\\s*(#[0-9a-fA-F]{3,8})\\s*;`).exec(root)?.[1];
  if (!value) throw new Error(`No hex value for --trade-${name} in ${TOKENS_FILE}.`);
  return value.toLowerCase();
}

const round = (n) => Number(n.toFixed(3));

/**
 * One icon as SVG markup, drawn on a 512 grid.
 * @param {{ radius: number, bolt: number }} spec
 * @param {{ paths: string[], background: string, bolt: string }} art
 */
export function iconSvg(spec, art) {
  const scale = (spec.bolt * GRID) / BOLT_BOX.height;
  const x = (GRID - BOLT_BOX.width * scale) / 2 - BOLT_BOX.x * scale;
  const y = (GRID - BOLT_BOX.height * scale) / 2 - BOLT_BOX.y * scale;
  const rx = round(spec.radius * GRID);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GRID} ${GRID}">`,
    `<rect width="${GRID}" height="${GRID}"${rx ? ` rx="${rx}"` : ""} fill="${art.background}"/>`,
    `<g fill="${art.bolt}" transform="translate(${round(x)} ${round(y)}) scale(${round(scale)})">`,
    ...art.paths.map((d) => `<path d="${d}"/>`),
    "</g>",
    "</svg>",
    "",
  ].join("\n");
}

/** Forest square, Lime bolt (the customer signature: the brand's default colours). */
export function brandArt(root = ROOT) {
  const css = readFileSync(path.join(root, TOKENS_FILE), "utf8");
  return {
    paths: boltPaths(readFileSync(path.join(root, LOGO_FILE), "utf8")),
    background: rootColour(css, "forest"),
    bolt: rootColour(css, "lime"),
  };
}

async function main() {
  const { chromium } = await import("@playwright/test");
  const art = brandArt();
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim() || undefined;
  const browser = await chromium.launch({ executablePath });
  try {
    for (const spec of ICONS) {
      const svg = iconSvg(spec, art);
      const out = path.join(ROOT, spec.file);
      mkdirSync(path.dirname(out), { recursive: true });
      if (spec.size === null) {
        writeFileSync(out, svg);
      } else {
        const page = await browser.newPage({ viewport: { width: spec.size, height: spec.size } });
        const sized = svg.replace("<svg ", `<svg width="${spec.size}" height="${spec.size}" `);
        await page.setContent(`<!doctype html><body style="margin:0;background:transparent">${sized}</body>`);
        await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: spec.size, height: spec.size } });
        await page.close();
      }
      console.log(`${spec.file}  ${spec.size ? `${spec.size}px` : "svg"}  ${spec.use}`);
    }
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
