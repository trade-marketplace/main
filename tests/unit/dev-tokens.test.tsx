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
    expect(html).toMatch(/^<div[^>]*data-page-mode="customer"/);
    for (const mode of ["customer", "trade", "office"]) expect(html).toContain(`data-mode="${mode}"`);
  });

  it("switches the whole page with ?mode= and ignores unknown modes", async () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(await render({ mode: "trade" })).toMatch(/<header data-mode="trade"/);
    expect(await render({ mode: "office" })).toMatch(/<header data-mode="office"/);
    expect(await render({ mode: "purple" })).toMatch(/<header data-mode="customer"/);
  });

  it("keeps the side-by-side columns outside the page's mode, so the customer column is really customer", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const html = await render({ mode: "trade" });
    // <main> carries no mode; the modes section sits straight inside it, after the contents nav.
    expect(html).toMatch(/<main class="[^"]*">(?:(?!<\/main>)[\s\S])*?<\/nav><section id="modes"/);
    expect(html).not.toMatch(/<main[^>]*data-mode/);
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
