import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import Page, { metadata } from "@/app/(site)/how-it-works/page";

describe("How it works", () => {
  const html = renderToString(Page());

  it("renders the three steps, essentials, help and customer start in the shared shell", () => {
    for (const text of ["Post it", "Accept the price", "Sorted", "Free to post", "One fixed price", "No surprise bills", "Questions?", "Any job in Invercargill."]) expect(html).toContain(text);
    expect(html).toContain('href="/help"');
    expect(html).toContain('href="/jobs/new"');
    expect(html).not.toMatch(/<(main|header|footer)\b/);
    expect(metadata.alternates).toEqual({ canonical: "/how-it-works" });
  });

  it("never invents a live price, worker, rating or guarantee", () => {
    expect(html).not.toMatch(/\$|Jack|Wilson|aria-label="[^"]*stars|insurance|guaranteed|margin|estimate|refund/i);
    expect(html.match(/aria-hidden="true"><div inert=""/g)).toHaveLength(3);
    expect(html).not.toContain("<form");
  });
});
