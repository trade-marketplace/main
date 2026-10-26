import { describe, expect, it } from "vitest";

import { formatViolations } from "../e2e/support/format-violations";

describe("formatViolations (axe helper output)", () => {
  it("says so when there are none", () => {
    expect(formatViolations([], "/ at 390px")).toBe("No accessibility violations on / at 390px.");
  });

  it("lists each violation with its impact, rule, help link and where it is", () => {
    const message = formatViolations(
      [
        {
          id: "image-alt",
          impact: "critical",
          help: "Images must have alternative text",
          helpUrl: "https://dequeuniversity.com/rules/axe/4.13/image-alt",
          nodes: [{ target: ["main > img"], failureSummary: "Fix any of the following:\n  Element has no alt attribute" }],
        },
        { id: "region", impact: null, help: "All content should be in landmarks", helpUrl: "https://x", nodes: [] },
      ],
      "/ at 1440px",
    );
    expect(message).toContain("2 accessibility violation(s) on / at 1440px:");
    expect(message).toContain("- [critical] image-alt: Images must have alternative text");
    expect(message).toContain("https://dequeuniversity.com/rules/axe/4.13/image-alt");
    expect(message).toContain("at main > img");
    expect(message).toContain("    Element has no alt attribute");
    expect(message).toContain("- [unknown] region:");
  });
});
