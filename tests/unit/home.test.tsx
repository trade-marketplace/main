import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import Home from "@/app/(site)/page";

describe("placeholder home page", () => {
  const html = renderToString(<Home />);

  it("renders the product name as the page heading", () => {
    expect(html).toMatch(/<h1[^>]*>Trade Marketplace<\/h1>/);
  });

  it("keeps the bolt artwork hidden from screen readers", () => {
    const svgs = html.match(/<svg[^>]*>/g) ?? [];
    expect(svgs.length).toBe(2);
    for (const svg of svgs) expect(svg).toContain('aria-hidden="true"');
  });
});
