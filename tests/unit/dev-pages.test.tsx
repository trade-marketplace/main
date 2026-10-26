/// <reference types="vite/client" />
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { unstable_noStore } from "next/cache";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEV_PAGES_ENV,
  devPagesAllowed,
  guardDevPage,
} from "@/server/dev-pages";

vi.mock("next/cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/cache")>()),
  unstable_noStore: vi.fn(),
}));

type DevPage = (props: {
  searchParams: Promise<Record<string, string>>;
}) => Promise<unknown>;

// Every /dev page, found and imported automatically, so a new preview page is covered without editing this file.
// (If a page you just added shows up as missing locally, Vitest's cache is stale: delete node_modules/.vitest-cache.)
const modules = import.meta.glob<{ default: DevPage }>("../../src/app/dev/**/page.tsx", { eager: true });
const PAGES: Record<string, DevPage> = Object.fromEntries(
  Object.entries(modules).map(([file, module]) => [
    file.replace("../../src/app", "").replace(/\/page\.tsx$/, ""),
    module.default,
  ]),
);

const open = (page: DevPage) => page({ searchParams: Promise.resolve({}) });
const NOT_FOUND = { digest: expect.stringContaining("404") };

/** Every page.tsx under src/app/dev, as its route. */
function devPageRoutes(dir = "src/app/dev", route = "/dev"): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory())
      return devPageRoutes(join(dir, entry.name), `${route}/${entry.name}`);
    return /^page\.[jt]sx?$/.test(entry.name) ? [route] : [];
  });
}

/** A production build (`next start`) with nothing else set, like a deployment that isn't on Vercel. */
function productionBuild(extra: Record<string, string> = {}) {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv(DEV_PAGES_ENV, "");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("VERCEL_ENV", "");
  for (const [name, value] of Object.entries(extra)) vi.stubEnv(name, value);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("devPagesAllowed", () => {
  it("allows dev pages in development", () => {
    expect(devPagesAllowed({ NODE_ENV: "development" })).toBe(true);
    expect(devPagesAllowed({ NODE_ENV: "test" })).toBe(true);
  });

  it("refuses them in a production build without the screenshot variable", () => {
    expect(devPagesAllowed({ NODE_ENV: "production" })).toBe(false);
  });

  it("allows them in a production build when the screenshot workflow sets the variable to 1", () => {
    expect(
      devPagesAllowed({ NODE_ENV: "production", SCREENSHOT_DEV_PAGES: "1" }),
    ).toBe(true);
  });

  it("only counts exactly 1", () => {
    for (const value of ["", "0", "true", "yes", " 1", "1 "]) {
      expect(
        devPagesAllowed({
          NODE_ENV: "production",
          SCREENSHOT_DEV_PAGES: value,
        }),
        value,
      ).toBe(false);
    }
  });

  it("what if someone sets the variable on Vercel by mistake? Production still refuses", () => {
    expect(
      devPagesAllowed({
        NODE_ENV: "production",
        SCREENSHOT_DEV_PAGES: "1",
        VERCEL_ENV: "production",
      }),
    ).toBe(false);
    expect(
      devPagesAllowed({
        NODE_ENV: "production",
        SCREENSHOT_DEV_PAGES: "1",
        VERCEL: "1",
      }),
    ).toBe(false);
  });

  it("refuses on a Vercel preview deployment too, even with the variable", () => {
    expect(
      devPagesAllowed({
        NODE_ENV: "production",
        SCREENSHOT_DEV_PAGES: "1",
        VERCEL_ENV: "preview",
      }),
    ).toBe(false);
  });

  it("refuses on Vercel production even if NODE_ENV says development", () => {
    expect(
      devPagesAllowed({ NODE_ENV: "development", VERCEL_ENV: "production" }),
    ).toBe(false);
  });
});

describe("guardDevPage", () => {
  it("is a 404 when dev pages aren't allowed", () => {
    expect(() => guardDevPage({ NODE_ENV: "production" })).toThrow(
      expect.objectContaining(NOT_FOUND),
    );
  });

  it("makes the page render per request, so `next build` can't bake in the 404 before the variable is set", () => {
    vi.mocked(unstable_noStore).mockClear();
    expect(() => guardDevPage({ NODE_ENV: "production" })).toThrow();
    expect(unstable_noStore).toHaveBeenCalledTimes(1);
  });

  it("does nothing when they are", () => {
    expect(() =>
      guardDevPage({ NODE_ENV: "production", SCREENSHOT_DEV_PAGES: "1" }),
    ).not.toThrow();
  });
});

describe("every /dev page", () => {
  it("uses the shared guard", () => {
    expect(devPageRoutes().sort()).toEqual(Object.keys(PAGES).sort());
    for (const route of Object.keys(PAGES)) {
      const source = readFileSync(`src/app${route}/page.tsx`, "utf8");
      expect(source, route).toContain(
        'import { guardDevPage } from "@/server/dev-pages";',
      );
      expect(source, route).toMatch(/\n {2}guardDevPage\(\);\n/);
      expect(source, route).not.toMatch(/process\.env/);
    }
  });

  for (const [route, page] of Object.entries(PAGES)) {
    describe(route, () => {
      it("is a 404 in a production build without the screenshot variable", async () => {
        productionBuild();
        await expect(open(page)).rejects.toMatchObject(NOT_FOUND);
      });

      it("renders in a production build when the screenshot workflow turns it on", async () => {
        productionBuild({ [DEV_PAGES_ENV]: "1" });
        await expect(open(page)).resolves.toBeTruthy();
      });

      it("is still a 404 on Vercel production with the variable set by mistake", async () => {
        productionBuild({
          [DEV_PAGES_ENV]: "1",
          VERCEL: "1",
          VERCEL_ENV: "production",
        });
        await expect(open(page)).rejects.toMatchObject(NOT_FOUND);
      });

      it("is still a 404 on a Vercel preview with the variable set", async () => {
        productionBuild({
          [DEV_PAGES_ENV]: "1",
          VERCEL: "1",
          VERCEL_ENV: "preview",
        });
        await expect(open(page)).rejects.toMatchObject(NOT_FOUND);
      });
    });
  }
});
