import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);
const read = (file: string) => readFileSync(new URL(file, root), "utf8");

describe("Node version pin", () => {
  const engines: string = JSON.parse(read("package.json")).engines.node;
  const nvmMajor = Number(read(".nvmrc").trim());

  it("pins the same major version in .nvmrc and package.json engines", () => {
    const [, min, max] = /^>=(\d+)\.\d+ <(\d+)$/.exec(engines) ?? [];
    expect(Number(min)).toBe(nvmMajor);
    expect(Number(max)).toBe(nvmMajor + 1);
  });

  it("makes npm refuse to install on a different Node version", () => {
    expect(read(".npmrc")).toMatch(/^engine-strict=true$/m);
  });

  it("is running the pinned version", () => {
    expect(Number(process.versions.node.split(".")[0])).toBe(nvmMajor);
  });
});
