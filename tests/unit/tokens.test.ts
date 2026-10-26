import { existsSync, readFileSync, statSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { kindForSection, parseTokens } from "@/app/dev/tokens/parse-tokens";
import { FONT_PRELOADS } from "@/lib/fonts";
import { MODES } from "@/lib/mode";

const root = new URL("../../", import.meta.url);
const read = (file: string) => readFileSync(new URL(file, root), "utf8");

const appCss = read("src/styles/tokens.css");
const designCss = read("docs/design/tokens.css");
const app = parseTokens(appCss);

describe("tokens.css in the app", () => {
  it("has exactly the same tokens and values as docs/design/tokens.css", () => {
    const design = parseTokens(designCss);
    const flat = (p: typeof app) => p.sections.flatMap((s) => s.tokens.map((t) => [t.name, t.value]));
    expect(flat(app)).toEqual(flat(design));
    expect(app.modes).toEqual(design.modes);
  });

  it("parses every section and token", () => {
    const names = app.sections.flatMap((s) => s.tokens.map((t) => t.name));
    expect(app.sections.map((s) => s.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(names).toContain("--trade-forest");
    expect(names).toContain("--trade-ease-in-out");
    const rootBlock = /:root\s*\{([^}]*)\}/.exec(appCss)![1].replace(/\/\*[\s\S]*?\*\//g, "");
    expect(names.length).toBe((rootBlock.match(/--trade-[\w-]+\s*:/g) ?? []).length);
    expect(new Set(names).size).toBe(names.length);
    // Every section gets a proper display on /dev/tokens.
    expect(app.sections.filter((s) => s.kind === "other")).toEqual([]);
  });

  it("keeps notes from the comments", () => {
    const forest = app.sections[0].tokens.find((t) => t.name === "--trade-forest");
    expect(forest).toEqual({ name: "--trade-forest", value: "#0c251d", note: "core: headers, text, dark surfaces" });
    // Mode overrides keep their own note (contrast in that mode), and have none when the file gives none.
    expect(app.modes.trade["--trade-action"].note).toBe("Forest label 6.5:1");
    expect(app.modes.office["--trade-on-action"]).toEqual({ name: "--trade-on-action", value: "#ffffff" });
  });

  it("defines the trade and office overrides for every mode token, so switching mode is one attribute", () => {
    const modeTokens = app.sections.find((s) => s.title.startsWith("Mode"))!.tokens.map((t) => t.name);
    for (const mode of MODES.filter((m) => m !== "customer")) {
      expect(Object.keys(app.modes[mode]).sort()).toEqual([...modeTokens].sort());
    }
  });

  it("keeps labels on coloured fills Forest (#0C251D) in customer and trade mode", () => {
    const root = Object.fromEntries(app.sections.flatMap((s) => s.tokens.map((t) => [t.name, t.value])));
    expect(root["--trade-forest"].toLowerCase()).toBe("#0c251d");
    expect(root["--trade-on-action"]).toBe("var(--trade-forest)");
    expect(root["--trade-on-signature"]).toBe("var(--trade-forest)");
    expect(app.modes.trade["--trade-on-action"].value).toBe("var(--trade-forest)");
    expect(app.modes.trade["--trade-on-signature"].value).toBe("var(--trade-forest)");
    expect(app.modes.office["--trade-on-signature"].value).toBe("var(--trade-forest)");
  });

  it("sorts sections into the right kind", () => {
    expect(kindForSection("Brand palette (raw)")).toBe("colour");
    expect(kindForSection("Type (Roboto Flex). Display = wght 900, wdth 151, opsz 28")).toBe("type");
    expect(kindForSection("Motion")).toBe("motion");
    expect(kindForSection("Something new")).toBe("other");
  });
});

describe("fonts", () => {
  const faces = [...appCss.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]);

  it("declares Trade Display, Trade UI and Material Symbols Rounded", () => {
    const families = faces.map((f) => /font-family:\s*'([^']+)'/.exec(f)?.[1]);
    expect(families).toEqual(["Trade Display", "Trade UI", "Material Symbols Rounded"]);
  });

  it("uses font-display: swap for the text fonts", () => {
    for (const face of faces.filter((f) => f.includes("'Trade "))) expect(face).toContain("font-display: swap");
  });

  it("serves every woff2 the tokens file points at from public/", () => {
    const urls = [...appCss.matchAll(/url\('([^']+\.woff2)'\)/g)].map((m) => m[1]);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(existsSync(new URL(`public${url}`, root)), url).toBe(true);
  });

  it("serves the same font files as docs/design/fonts", () => {
    const pairs = [
      ["public/fonts/roboto-flex/RobotoFlex.woff2", "docs/design/fonts/RobotoFlex.woff2"],
      ["public/fonts/material-symbols/MaterialSymbolsRounded.woff2", "docs/design/fonts/MaterialSymbolsRounded.woff2"],
    ];
    for (const [served, source] of pairs) {
      expect(statSync(new URL(served, root)).size).toBe(statSync(new URL(source, root)).size);
    }
  });

  it("keeps the licence files next to the fonts", () => {
    expect(read("public/fonts/roboto-flex/OFL.txt")).toContain("SIL OPEN FONT LICENSE Version 1.1");
    expect(read("public/fonts/material-symbols/LICENSE")).toContain("Apache License");
  });

  it("preloads every woff2 the tokens file uses", () => {
    const urls = [...new Set([...appCss.matchAll(/url\('([^']+\.woff2)'\)/g)].map((m) => m[1]))];
    expect(FONT_PRELOADS.map((f) => f.href).sort()).toEqual(urls.sort());
  });
});
