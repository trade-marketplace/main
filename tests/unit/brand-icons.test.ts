import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { boltPaths, brandArt, ICONS, iconSvg, rootColour } from "../../scripts/brand/icons.mjs";
import { tokenColour } from "@/server/brand-colours";

import { pngInfo } from "../support/png";

const repoFile = (file: string) => new URL(`../../${file}`, import.meta.url);

describe("favicon and app icons (scripts/brand/icons.mjs)", () => {
  it("draws the bolt from the logo file, on Forest, in Lime (the tokens)", () => {
    const art = brandArt();
    expect(art.paths).toHaveLength(2);
    expect(art.background).toBe(tokenColour("forest"));
    expect(art.bolt).toBe(tokenColour("lime"));
  });

  it("has a committed SVG favicon that matches the logo and tokens (run the script if this fails)", () => {
    const svgIcon = ICONS.find((icon) => icon.size === null)!;
    expect(svgIcon.file).toBe("src/app/icon.svg");
    expect(readFileSync(repoFile(svgIcon.file), "utf8")).toBe(iconSvg(svgIcon, brandArt()));
  });

  it("has every PNG committed at its size", () => {
    for (const icon of ICONS.filter((i) => i.size !== null)) {
      const { width, height } = pngInfo(readFileSync(repoFile(icon.file)));
      expect([width, height], icon.file).toEqual([icon.size, icon.size]);
    }
  });

  it("gives the 32px favicon and the apple-touch-icon the mockup sizes", () => {
    expect(ICONS.map((i) => `${i.file} ${i.size ?? "svg"}`)).toEqual([
      "src/app/icon.svg svg",
      "src/app/icon.png 32",
      "src/app/apple-icon.png 180",
      "public/icons/icon-192.png 192",
      "public/icons/icon-512.png 512",
      "public/icons/icon-maskable-512.png 512",
    ]);
  });

  it("makes the icons the device masks itself full squares with no transparency", () => {
    for (const file of ["src/app/apple-icon.png", "public/icons/icon-maskable-512.png"]) {
      expect(ICONS.find((i) => i.file === file)?.radius).toBe(0);
      expect(pngInfo(readFileSync(repoFile(file))).hasAlpha, file).toBe(false);
    }
  });

  it("keeps the maskable bolt inside Android's safe zone (the middle circle, 40% radius)", () => {
    const maskable = ICONS.find((i) => i.file.includes("maskable"))!;
    const height = maskable.bolt;
    const width = (height * 26.2) / 43.6;
    // Even the corners of the bolt's box are inside the circle.
    expect(Math.hypot(width / 2, height / 2)).toBeLessThanOrEqual(0.4);
  });

  it("reads only the logo's two bolt paths and the tokens' hex values", () => {
    expect(() => boltPaths('<svg><path d="M0 0Z"/></svg>')).toThrow("Expected the 2 bolt paths");
    expect(rootColour(":root { --trade-forest: #0C251D; }", "forest")).toBe("#0c251d");
    expect(() => rootColour(":root { }", "forest")).toThrow("No hex value for --trade-forest");
  });
});
