import { describe, expect, it } from "vitest";
import { variationExample } from "@/app/dev/components/office-variation-pricing/preview-data";
import { EXTRA_WORK_QUEUE, variationPricingHref, variationQueueReturn } from "@/lib/office-variation";
import { variationPricePreview } from "@/server/office/variation-read";

describe("extra-work queue and server previews", () => {
  it("allows only bounded extra-queue returns and keeps filters", () => {
    expect(variationQueueReturn("/admin?tab=extra&q=Switch&page=2")).toBe("/admin?tab=extra&q=Switch&page=2");
    for (const raw of ["https://evil.test", "//evil.test", "/admin?tab=extra&next=https://evil.test", "/admin?tab=price", "/admin?tab=extra&tab=extra", "/admin?tab=extra#bad", "/admin?tab=extra\\evil", ["/admin?tab=extra"], null]) expect(variationQueueReturn(raw)).toBe(EXTRA_WORK_QUEUE);
    expect(variationPricingHref("id", "/admin?tab=extra&q=Switch&page=2")).toBe("/admin/variations/id?from=%2Fadmin%3Ftab%3Dextra%26q%3DSwitch%26page%3D2");
  });
  it("does not reapply the original two-hour minimum and never serializes the rates or photo paths", () => {
    const { source, data } = variationExample();
    expect(data.preview?.total).toBe("$72.50");
    expect(data.requestedHours).toBe("0.5 h");
    expect(JSON.stringify(data)).not.toMatch(/workerRateCents|onCostBps|requestedById|path/);
    expect(variationPricePreview(source, { hours: "0", materials: "10" })).toMatchObject({ error: "invalid", field: "hours" });
    expect(variationPricePreview(source, { hours: "101", materials: "10" })).toMatchObject({ error: "invalid", field: "hours" });
    expect(variationPricePreview(source, { hours: "0.5", materials: "-1" })).toMatchObject({ error: "invalid", field: "materials" });
  });
});
