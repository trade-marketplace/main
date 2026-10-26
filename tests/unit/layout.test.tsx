import { prerender } from "react-dom/static";
import { describe, expect, it } from "vitest";

import RootLayout from "@/app/layout";
import { FONT_PRELOADS } from "@/lib/fonts";

// Render the whole document the way the server streams it, so the hoisted <head> tags are included.
async function renderDocument() {
  const { prelude } = await prerender(
    <RootLayout>
      <p>child</p>
    </RootLayout>,
  );
  return new Response(prelude).text();
}

describe("root layout", () => {
  it("renders the customer mode on <html> on the server, so the first paint has the right palette", async () => {
    expect(await renderDocument()).toMatch(/<html lang="en-NZ" data-mode="customer">/);
  });

  it("preloads each font file as a cross-origin woff2 in <head>", async () => {
    const html = await renderDocument();
    const head = /<head>([\s\S]*?)<\/head>/.exec(html)?.[1] ?? "";
    expect(FONT_PRELOADS.length).toBe(2);
    for (const { href, fetchPriority } of FONT_PRELOADS) {
      const tag = new RegExp(`<link[^>]*href="${href}"[^>]*>`).exec(head)?.[0] ?? "";
      expect(tag, href).toContain('rel="preload"');
      expect(tag).toContain('as="font"');
      expect(tag).toContain('type="font/woff2"');
      // crossorigin="" and crossorigin="anonymous" mean the same; fonts are always fetched in CORS mode.
      expect(tag).toMatch(/crossorigin="(anonymous)?"/);
      expect(tag.toLowerCase()).toContain(`fetchpriority="${fetchPriority}"`);
      // Exactly once: no duplicate downloads.
      expect(html.split(`href="${href}"`).length - 1).toBe(1);
    }
  });

  it("renders its children", async () => {
    expect(await renderDocument()).toContain("<p>child</p>");
  });
});
