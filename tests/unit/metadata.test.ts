import { describe, expect, it } from "vitest";

import { formatTitle, pageTitle, privateMetadata, SITE_NAME, SITE_URL, TITLE_TEMPLATE } from "@/lib/metadata";

describe("page titles", () => {
  it("follows the mockup pattern: [Page] · [Job] | Trade Marketplace", () => {
    expect(TITLE_TEMPLATE.replace("%s", pageTitle("Your price", "Sub wiring"))).toBe(
      "Your price · Sub wiring | Trade Marketplace",
    );
  });

  it("skips blank parts of a page title", () => {
    expect(pageTitle("Messages", undefined, "  ", null)).toBe("Messages");
    expect(pageTitle(" Your price ", "Sub wiring ")).toBe("Your price · Sub wiring");
  });

  it("is just the site name when a page has no title", () => {
    expect(formatTitle()).toBe(SITE_NAME);
    expect(formatTitle("   ")).toBe("Trade Marketplace");
  });

  it("adds nothing when there's nothing unread", () => {
    expect(formatTitle("Messages")).toBe("Messages | Trade Marketplace");
    expect(formatTitle("Messages", 0)).toBe("Messages | Trade Marketplace");
  });

  it("puts the unread count in front, as in the mockup", () => {
    expect(formatTitle("Messages", 2)).toBe("(2) Messages | Trade Marketplace");
    expect(formatTitle(pageTitle("Your price", "Sub wiring"), 3)).toBe("(3) Your price · Sub wiring | Trade Marketplace");
    expect(formatTitle(null, 1)).toBe("(1) Trade Marketplace");
  });

  it("caps a big count at 99+ so the page name stays visible in the tab", () => {
    expect(formatTitle("Messages", 99)).toBe("(99) Messages | Trade Marketplace");
    expect(formatTitle("Messages", 100)).toBe("(99+) Messages | Trade Marketplace");
  });

  it("ignores counts that aren't a real positive number", () => {
    expect(formatTitle("Messages", -4)).toBe("Messages | Trade Marketplace");
    expect(formatTitle("Messages", Number.NaN)).toBe("Messages | Trade Marketplace");
    expect(formatTitle("Messages", Number.POSITIVE_INFINITY)).toBe("Messages | Trade Marketplace");
    expect(formatTitle("Messages", 2.7)).toBe("(2) Messages | Trade Marketplace");
  });
});

describe("private pages", () => {
  it("are noindex, nofollow and drop the inherited share image and Twitter card", () => {
    expect(privateMetadata).toEqual({ robots: { index: false, follow: false }, openGraph: null, twitter: null });
  });
});

describe("site URL", () => {
  it("is the primary domain from DECISIONS.md", () => {
    expect(SITE_URL.href).toBe("https://trademarketplace.nz/");
  });
});
