import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import Page, { metadata } from "@/app/(site)/trust/page";
import { PROMISES } from "@/components/site/TrustPage";
import { FOOTER_COLUMNS } from "@/components/site/site-links";
import { loadHelpArticles } from "@/server/help/articles";

describe("Trust & safety", () => {
  const html = renderToString(Page());
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  it("renders the hero, six promises, contact and the customer start in the shared shell", () => {
    for (const expected of ["Trust &amp; safety", "Your home.", "Done right.", "Here’s exactly what we check and what happens if something goes wrong.", "Questions?", "Got a job that needs doing?"]) expect(html).toContain(expected);
    for (const promise of PROMISES) {
      expect(html).toContain(promise.title);
      expect(html).toContain(`href="/help/${promise.slug}"`);
    }
    expect(PROMISES).toHaveLength(6);
    expect(html).toContain('href="/contact"');
    expect(html).toContain('href="/jobs/new"');
    expect(html).not.toMatch(/<(main|header|footer)\b/);
    expect(metadata.alternates).toEqual({ canonical: "/trust" });
    expect(metadata.title).toBe("Trust & safety");
  });

  it("says any job and Invercargill, not just sparkies", () => {
    expect(text).toContain("Any kind of job, in Invercargill.");
    expect(String(metadata.description)).toMatch(/any job in Invercargill/);
    expect(text).not.toMatch(/sparkie|electricians? only/i);
  });

  it("links every promise to a published help article", async () => {
    const slugs = new Set((await loadHelpArticles()).map(article => article.slug));
    for (const promise of PROMISES) expect(slugs.has(promise.slug), promise.slug).toBe(true);
  });

  it("makes only claims DECISIONS.md and the help articles support", () => {
    // Open decisions (#280 strict checks, legal, insurance) and anything money-shaped must not appear.
    expect(text).not.toMatch(/insur|guarantee|liab|warrant|refund|lawyer|legal|background check|police|probation/i);
    expect(text).not.toMatch(/paperwork for you|we do the paperwork|do the paperwork/i);
    expect(text).not.toMatch(/\$|\d+\s?%|\b\d+\s?(hours?|days?|minutes?)\b/);
    expect(text).not.toMatch(/estimate|average|margin|pricing|worked out|fixed price/i);
    expect(text).not.toMatch(/official register|every tradie|each tradie|100%/i);
    expect(html).not.toContain("<form");
  });

  it("keeps the licence promise to licensed work and says who else is checked", () => {
    expect(text).toContain("Licensed workers have their licence checked by hand before they can take licensed work.");
    expect(text).toContain("Everyone else joins with photo ID, and checked workers get a verified badge.");
    expect(text).toContain("Electrical jobs that need one come with a Certificate of Compliance.");
    expect(text).toContain("You pay through us. Tradies are paid after you’ve checked the job.");
    expect(text).toContain("Nothing happens until you say yes.");
    expect(text).toContain("We pause the sign-off and sort it out.");
  });

  it("is reachable from the footer's Trust & safety link", () => {
    const links = FOOTER_COLUMNS.flatMap(column => column.links);
    expect(links).toContainEqual({ label: "Trust & safety", href: "/trust" });
  });

  it("draws the M10 bolt flash once, decoratively, with the verified shield", () => {
    expect(html).toContain("tm-flash");
    expect(html).toContain("verified_user");
    expect(html).toMatch(/class="[^"]*tm-flash[^"]*"[^>]*aria-hidden="true"/);
  });
});
