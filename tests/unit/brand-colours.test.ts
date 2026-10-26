import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { tokenColour, tokenColourFrom } from "@/server/brand-colours";

const tokensCss = readFileSync(new URL("../../src/styles/tokens.css", import.meta.url), "utf8");

describe("tokenColourFrom (the real tokens file)", () => {
  it("reads raw brand colours from :root", () => {
    expect(tokenColourFrom(tokensCss, "forest")).toBe("#0c251d");
    expect(tokenColourFrom(tokensCss, "paper")).toBe("#f1ece5");
    expect(tokenColourFrom(tokensCss, "--trade-lime")).toBe("#a6d754");
  });

  it("follows var() references to the literal colour", () => {
    expect(tokenColourFrom(tokensCss, "text")).toBe("#0c251d");
    expect(tokenColourFrom(tokensCss, "signature")).toBe("#a6d754");
  });

  it("uses each mode's overrides", () => {
    expect(tokenColourFrom(tokensCss, "signature", "customer")).toBe("#a6d754");
    expect(tokenColourFrom(tokensCss, "signature", "trade")).toBe("#eca154");
    expect(tokenColourFrom(tokensCss, "action", "trade")).toBe("#ff8200");
    expect(tokenColourFrom(tokensCss, "signature", "office")).toBe("#b7f0e4");
    expect(tokenColourFrom(tokensCss, "on-action", "office")).toBe("#ffffff");
    // Not overridden in a mode: the :root value.
    expect(tokenColourFrom(tokensCss, "forest", "trade")).toBe("#0c251d");
  });

  it("accepts rgb() values", () => {
    expect(tokenColourFrom(tokensCss, "text-on-dark-2")).toBe("rgb(255 255 255 / 72%)");
  });
});

describe("tokenColourFrom errors", () => {
  it("names a token that doesn't exist", () => {
    expect(() => tokenColourFrom(tokensCss, "purple")).toThrow("Token --trade-purple isn't in src/styles/tokens.css.");
  });

  it("refuses a token that isn't a colour", () => {
    expect(() => tokenColourFrom(tokensCss, "space-1")).toThrow('Token --trade-space-1 is "4px", not a colour.');
  });

  it("stops on a reference loop instead of hanging", () => {
    const css = ":root { --trade-a: var(--trade-b); --trade-b: var(--trade-a); }";
    expect(() => tokenColourFrom(css, "a")).toThrow("refers to itself");
  });

  it("ignores commented-out declarations", () => {
    const css = ":root { /* --trade-x: #000000; */ --trade-x: #123456; }";
    expect(tokenColourFrom(css, "x")).toBe("#123456");
  });
});

describe("tokenColour", () => {
  it("reads src/styles/tokens.css from the project folder", () => {
    expect(tokenColour("forest")).toBe(tokenColourFrom(tokensCss, "forest"));
    expect(tokenColour("signature", "trade")).toBe(tokenColourFrom(tokensCss, "signature", "trade"));
  });
});
