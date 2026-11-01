import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import Page, { metadata } from "@/app/(site)/how-it-works/page";

describe("How it works", () => {
  const html = renderToString(Page());

  it("renders the three steps, essentials, help and customer start in the shared shell", () => {
    for (const text of ["Post it", "Accept the price", "Sorted", "Free to post", "One fixed price", "No surprise bills", "Questions?", "Any job in Invercargill.", "Three steps. We make the hard calls for you.", "It costs nothing.", "You check it and rate them.", "Your price", "Jack Wilson"]) expect(html).toContain(text);
    expect(html).toContain('href="/help"');
    expect(html).toContain('href="/jobs/new"');
    expect(html).not.toMatch(/<(main|header|footer)\b/);
    expect(metadata.alternates).toEqual({ canonical: "/how-it-works" });
  });

  it("keeps the mockup's example price and tradie inside the three decorative, inert illustrations", () => {
    const illustrations = html.match(/aria-hidden="true"><div inert="">[\s\S]*?<\/div><\/div>(?=<\/li>)/g) ?? [];
    expect(illustrations).toHaveLength(3);
    const outside = illustrations.reduce((rest, part) => rest.replace(part, ""), html);
    expect(outside).not.toMatch(/\$|Jack|Wilson|stars/i);
    expect(html).not.toMatch(/insurance|guaranteed|margin|estimate|refund/i);
    expect(html).not.toContain("<form");
  });
});
