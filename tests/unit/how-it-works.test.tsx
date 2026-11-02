import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import Page, { metadata } from "@/app/(site)/how-it-works/page";

describe("How it works", () => {
  const html = renderToString(Page());

  it("renders the three steps, essentials, help and customer start in the shared shell", () => {
    for (const text of ["Post it", "Accept the price", "Sorted", "Free to post", "One fixed price", "Checked people", "Questions?", "Got a job that needs doing?", "Three steps. We make the hard calls for you.", "It costs nothing.", "You check it and rate them.", "Your price", "Jack Wilson"]) expect(html).toContain(text);
    expect(html).toContain('href="/help/is-it-free"');
    expect(html).toContain('href="/help/who-will-do-my-job"');
    expect(html).toContain('href="/help/extra-work"');
    expect(html).toContain('href="/jobs/new"');
    expect(html).not.toMatch(/<(main|header|footer)\b/);
    expect(metadata.alternates).toEqual({ canonical: "/how-it-works" });
  });

  it("uses the #419 step and promise copy, broad wording and no launch-area lock-in", () => {
    for (const text of [
      "It’s free and takes about two minutes. No account needed to start.",
      "You get one fixed price. Happy? Accept and pay. Not? Say no. It costs nothing.",
      "A checked, local worker takes the job and gets it done. You check it and rate them.",
      "Getting a price costs nothing, and there’s no obligation to go ahead.",
      "The price you accept is the price you pay. If the job turns out bigger, you see photos and the extra cost first, and it only goes ahead if you say yes.",
      "Licensed work is done by people whose licences we’ve checked. Everyone else joins with photo ID and is rated by people near you.",
    ]) expect(html).toContain(text);
    expect(html).not.toMatch(/Invercargill|tradie/i);
    expect(String(metadata.description)).not.toContain("Invercargill");
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
