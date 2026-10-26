import { prerender } from "react-dom/static";
import { afterEach, describe, expect, it, vi } from "vitest";

import RootLayout from "@/app/layout";
import { FONT_PRELOADS } from "@/lib/fonts";
import type { Role } from "@/lib/mode";
import { getViewer } from "@/server/auth/viewer";

// The layout reads the signed-in visitor on the server. Tests choose who that is; nobody by default.
vi.mock("@/server/auth/viewer", () => ({ getViewer: vi.fn(async () => null) }));

afterEach(() => vi.mocked(getViewer).mockReset().mockResolvedValue(null));

function signInAs(role: Role) {
  vi.mocked(getViewer).mockResolvedValue({
    userId: "user-1",
    email: "sam@example.nz",
    role,
    firstName: "Sam",
    emailVerified: true,
  });
}

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

  it("uses the signed-in visitor's role for the mode", async () => {
    signInAs("TRADIE");
    expect(await renderDocument()).toMatch(/<html lang="en-NZ" data-mode="trade">/);
    signInAs("ADMIN");
    expect(await renderDocument()).toMatch(/<html lang="en-NZ" data-mode="office">/);
    signInAs("CUSTOMER");
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

describe("root layout when the visitor can't be read", () => {
  it("falls back to the signed-out palette instead of failing the page", async () => {
    vi.mocked(getViewer).mockRejectedValue(new Error("connection reset"));
    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    expect(await renderDocument()).toMatch(/<html lang="en-NZ" data-mode="customer">/);
  });
});
