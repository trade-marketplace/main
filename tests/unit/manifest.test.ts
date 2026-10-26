import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import manifest from "@/app/manifest";
import { tokenColour } from "@/server/brand-colours";

import { pngInfo } from "../support/png";

const publicFile = (src: string) => new URL(`../../public${src}`, import.meta.url);

describe("web app manifest", () => {
  const m = manifest();

  it("names the app as the mockup says", () => {
    expect(m.name).toBe("Trade Marketplace");
    expect(m.short_name).toBe("TradeMkt");
    expect(m.display).toBe("standalone");
    expect(m.start_url).toBe("/");
    expect(m.lang).toBe("en-NZ");
  });

  it("takes its colours from the tokens: Forest theme, Paper background", () => {
    expect(m.theme_color).toBe(tokenColour("forest"));
    expect(m.background_color).toBe(tokenColour("paper"));
    expect(m.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("lists 192 and 512 icons plus a maskable 512", () => {
    expect(m.icons?.map((i) => `${i.sizes} ${i.purpose}`)).toEqual([
      "192x192 any",
      "512x512 any",
      "512x512 maskable",
    ]);
  });

  it("points at icon files that exist, are PNGs and are the size it says", () => {
    for (const icon of m.icons ?? []) {
      expect(icon.type).toBe("image/png");
      const { width, height } = pngInfo(readFileSync(publicFile(icon.src)));
      expect(`${width}x${height}`, icon.src).toBe(icon.sizes);
    }
  });

  it("has a full-bleed maskable icon (no transparent corners for Android to fill)", () => {
    const maskable = m.icons?.find((i) => i.purpose === "maskable");
    expect(pngInfo(readFileSync(publicFile(maskable!.src))).hasAlpha).toBe(false);
  });
});
