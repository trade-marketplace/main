import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CustomerJob } from "@/components/jobs/CustomerJob";
import { customerJobDetailsSchema, customerPriceDelayed, CUSTOMER_PRICE_DELAY_MS, waitingJobRevision } from "@/lib/customer-job-waiting";
import { customerJobView } from "@/server/views";
import { exampleJob, VIEWERS } from "@/app/dev/components/job-views/preview-data";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe("getting your price", () => {
  it("allows editing until priced while keeping the delay and free cancellation in REVIEW", () => {
    expect(customerPriceDelayed(CUSTOMER_PRICE_DELAY_MS)).toBe(false);
    expect(customerPriceDelayed(CUSTOMER_PRICE_DELAY_MS + 1)).toBe(true);
    for (const status of ["REVIEW", "QUOTE_BOUNTY", "PRICED", "BOOKABLE", "CANCELLED"] as const) {
      const html = renderToStaticMarkup(<CustomerJob job={customerJobView(VIEWERS.customer, exampleJob({ status }))!} initialAgeMs={CUSTOMER_PRICE_DELAY_MS + 1} />);
      expect(html.includes("Taking a little longer than usual")).toBe(status === "REVIEW");
      expect(html.includes(">Edit job</span>")).toBe(status === "REVIEW" || status === "QUOTE_BOUNTY");
      expect(html.includes(">Cancel job</span>")).toBe(status === "REVIEW");
      expect(html).not.toMatch(/workerGrossCents|marginCents|estimates|Earn \$/);
    }
  });
  it("validates complete textual details and rejects unwanted business/private fields", () => {
    const input = { title: " Move the couch ", description: "Move the couch upstairs.", accessNotes: "Side gate" };
    expect(customerJobDetailsSchema.parse(input).title).toBe("Move the couch");
    for (const value of [{ ...input, title: "" }, { ...input, description: "short" }, { ...input, accessNotes: "a".repeat(1001) }, { ...input, priceCents: 1 }, { ...input, customerId: VIEWERS.worker.userId }]) expect(customerJobDetailsSchema.safeParse(value).success).toBe(false);
    expect(waitingJobRevision("2026-11-05T01:00:00.000Z", input)).not.toBe(waitingJobRevision("2026-11-05T01:00:00.000Z", { ...input, description: "Two couches need moving." }));
  });
  it("keeps a proven published cancellation price when only older unrelated history timestamps tie", () => {
    const latest = new Date("2026-11-05T01:00:00Z"), older = new Date("2026-11-04T01:00:00Z");
    const before = [{ fromStatus: "REVIEW" as const, toStatus: "PRICED" as const, createdAt: older }, { fromStatus: null, toStatus: "REVIEW" as const, createdAt: older }];
    for (const prior of [before, [...before].reverse()]) {
      const row = exampleJob({ status: "CANCELLED", updatedAt: latest, statusHistory: [{ fromStatus: "PRICED", toStatus: "CANCELLED", createdAt: latest }, ...prior] });
      expect(customerJobView(VIEWERS.customer, row)).toMatchObject({ priceCents: 37200, gstCents: 4852 });
    }
  });
  it("fails closed when a cancellation origin is missing, tied or has a broken approval link", () => {
    const now = new Date("2026-11-05T01:00:00Z"), before = new Date("2026-11-04T01:00:00Z");
    const cases = [[],
      [{ fromStatus: "PRICED" as const, toStatus: "CANCELLED" as const, createdAt: now }, { fromStatus: "REVIEW" as const, toStatus: "PRICED" as const, createdAt: now }],
      [{ fromStatus: "CANCEL_REVIEW" as const, toStatus: "CANCELLED" as const, createdAt: now }, { fromStatus: "REVIEW" as const, toStatus: "PRICED" as const, createdAt: before }],
      [{ fromStatus: "CANCEL_REVIEW" as const, toStatus: "CANCELLED" as const, createdAt: now }],
    ];
    for (const statusHistory of cases) {
      const row = exampleJob({ status: "CANCELLED", updatedAt: now, statusHistory });
      expect(customerJobView(VIEWERS.customer, row)).toMatchObject({ priceCents: null, gstCents: null });
    }
  });
});
