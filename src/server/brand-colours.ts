import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";

// Colour values from src/styles/tokens.css for places that can't use CSS variables: the web app manifest and the
// share images drawn by next/og. Reading the tokens file keeps "no hex outside tokens.css" true
// (tests/unit/no-hex.test.ts) and means a token change reaches these files on the next build.
//
// Only use this in code that runs at build time (manifest.ts, opengraph-image.tsx: both are prerendered).
// The tokens file isn't shipped with request-time server code.

export type TokenMode = "customer" | "trade" | "office";

const TOKENS_FILE = path.join("src", "styles", "tokens.css");
const BLOCK = /(:root|\[data-mode="([\w-]+)"\])\s*\{([^}]*)\}/g;
const DECLARATION = /(--trade-[\w-]+)\s*:\s*([^;]+);/g;
const VAR = /^var\(\s*(--trade-[\w-]+)\s*\)$/;
const COLOUR = /^(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))$/;

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Every `--trade-*` value for one mode: the `:root` values with that mode's overrides on top. */
function declarations(css: string, mode: TokenMode): Map<string, string> {
  const root = new Map<string, string>();
  const overrides = new Map<string, string>();
  for (const [, selector, blockMode, body] of stripComments(css).matchAll(BLOCK)) {
    const target = selector === ":root" ? root : blockMode === mode ? overrides : null;
    if (!target) continue;
    for (const [, name, value] of body.matchAll(DECLARATION)) target.set(name, value.trim());
  }
  return new Map([...root, ...overrides]);
}

/**
 * The literal colour a token holds in a mode, following `var(--trade-…)` references, e.g.
 * `tokenColourFrom(css, "signature", "trade")` → the Amber hex. Throws if the token is missing or isn't a colour.
 */
export function tokenColourFrom(css: string, token: string, mode: TokenMode = "customer"): string {
  const values = declarations(css, mode);
  const seen = new Set<string>();
  let name = token.startsWith("--") ? token : `--trade-${token}`;

  for (;;) {
    if (seen.has(name)) throw new Error(`Token ${name} refers to itself in ${TOKENS_FILE}.`);
    seen.add(name);
    const value = values.get(name);
    if (value === undefined) throw new Error(`Token ${name} isn't in ${TOKENS_FILE}.`);
    const reference = VAR.exec(value);
    if (reference) {
      name = reference[1];
      continue;
    }
    if (!COLOUR.test(value)) throw new Error(`Token ${name} is "${value}", not a colour.`);
    return value;
  }
}

let cached: string | undefined;

function tokensCss(): string {
  cached ??= readFileSync(path.join(process.cwd(), TOKENS_FILE), "utf8");
  return cached;
}

/** The literal colour of a token from src/styles/tokens.css, e.g. `tokenColour("forest")`. */
export function tokenColour(token: string, mode: TokenMode = "customer"): string {
  return tokenColourFrom(tokensCss(), token, mode);
}
