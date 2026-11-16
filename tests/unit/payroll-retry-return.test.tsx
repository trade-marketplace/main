import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PayrollLoadError } from "@/components/account/PayrollSettings";

describe("payroll load-error retry", () => {
  it("retains the canonical filtered board return", () => {
    const html = renderToStaticMarkup(<PayrollLoadError next="/jobs?kind=bounty&distance=10" />);
    expect(html).toContain('href="/profile/payroll?next=%2Fjobs%3Fkind%3Dbounty%26distance%3D10"');
    expect(html).toContain("Try again");
  });
  it.each([undefined, null, "https://outside.test/jobs", "//outside.test/jobs", "/profile", "/jobs/other", "/jobs?x=" + "a".repeat(4096)])("keeps the plain retry when the return is invalid or absent: %s", next => {
    const html = renderToStaticMarkup(<PayrollLoadError next={next} />);
    expect(html).toContain('href="/profile/payroll"');
    expect(html).not.toContain("?next=");
  });
});
