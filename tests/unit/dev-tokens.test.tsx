import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import TokensPage from "@/app/dev/tokens/page";

const render = async (params: Record<string, string> = {}) =>
  renderToString(await TokensPage({ searchParams: Promise.resolve(params) }));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("/dev/tokens", () => {
  it("is a 404 in production builds", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(render()).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });

  it("shows every token in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const html = await render();
    for (const name of ["--trade-forest", "--trade-action", "--trade-fs-display", "--trade-space-20", "--trade-radius-sheet", "--trade-shadow-pop", "--trade-tap", "--trade-z-toast", "--trade-dur-slow", "--trade-ease-out"]) {
      expect(html, name).toContain(name);
    }
  });

  it("defaults to customer mode and shows all three modes side by side", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const html = await render();
    expect(html).toMatch(/^<div[^>]*data-mode="customer"/);
    for (const mode of ["customer", "trade", "office"]) expect(html).toContain(`data-mode="${mode}"`);
  });

  it("switches the whole page with ?mode= and ignores unknown modes", async () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(await render({ mode: "trade" })).toMatch(/^<div[^>]*data-mode="trade"/);
    expect(await render({ mode: "office" })).toMatch(/^<div[^>]*data-mode="office"/);
    expect(await render({ mode: "purple" })).toMatch(/^<div[^>]*data-mode="customer"/);
  });

  it("can simulate the icon font failing, and every icon still has a label or text", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const html = await render({ icons: "off" });
    expect(html).toContain('data-icon-font="off"');
    const icons = html.match(/<span[^>]*translate="no"[^>]*>/g) ?? [];
    expect(icons.length).toBeGreaterThan(0);
    for (const icon of icons) expect(icon).toMatch(/aria-label="[^"]+"|aria-hidden="true"/);
  });
});
