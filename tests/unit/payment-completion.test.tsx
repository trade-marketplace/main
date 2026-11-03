import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { CheckoutPage } from "@/components/payments/Checkout";
import { PaymentDone } from "@/components/payments/PaymentDone";
import { PayFormView } from "@/components/payments/PayFormView";
import { loadPaymentCompletion } from "@/server/payments/completion";
import type { PaymentIntentsApi } from "@/server/payments/payments";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const pending = { jobId: "job", kind: "VARIATION", status: "PENDING", providerPaymentId: "pi_test", amountCents: 14800, variationRevision: 2, variation: { status: "PRICED", revision: 2, priceCents: 14800 } };
function fixture(overrides: Record<string, unknown> = {}) {
  const payment = { ...pending, ...overrides };
  const findFirst = vi.fn(async ({ where }: { where: { job: { customerId: string } } }) => where.job.customerId === "owner" ? payment : null);
  const retrieve = vi.fn(async () => ({ status: "succeeded" }));
  return { db: { payment: { findFirst } } as unknown as PrismaClient, retrieve, intents: () => ({ retrieve }) as unknown as PaymentIntentsApi, findFirst };
}
describe("trusted extra-work payment completion", () => {
  it("does not reveal a foreign payment or ask Stripe about it", async () => {
    const f = fixture(); expect(await loadPaymentCompletion(f.db, "foreign", "payment", f.intents)).toBeNull(); expect(f.retrieve).not.toHaveBeenCalled();
  });
  it("keeps unpaid/failed payments at checkout and fails closed when Stripe is unavailable", async () => {
    for (const status of ["PENDING", "FAILED"]) {
      const f = fixture({ status }); expect(await loadPaymentCompletion(f.db, "owner", "payment")).toMatchObject({ outcome: "unpaid" });
    }
    const f = fixture(); f.retrieve.mockRejectedValue(new Error("unavailable"));
    expect(await loadPaymentCompletion(f.db, "owner", "payment", f.intents)).toMatchObject({ outcome: "unpaid" });
  });
  it("does not infer approval from Stripe success while verified settlement is pending", async () => {
    const f = fixture(); expect(await loadPaymentCompletion(f.db, "owner", "payment", f.intents)).toEqual({ jobId: "job", outcome: "variation-checking" });
    expect(f.retrieve).toHaveBeenCalledWith("pi_test");
  });
  it("requires the actual paid variation approval, revision and charged amount", async () => {
    const approved = { status: "APPROVED", revision: 2, priceCents: 14800 };
    const f = fixture({ status: "PAID", variation: approved });
    expect(await loadPaymentCompletion(f.db, "owner", "payment", f.intents)).toMatchObject({ outcome: "variation-approved" });
    expect(f.retrieve).not.toHaveBeenCalled();
    for (const variation of [pending.variation, null, { ...approved, revision: 3 }, { ...approved, priceCents: 14900 }]) {
      expect(await loadPaymentCompletion(fixture({ status: "PAID", variation }).db, "owner", "payment")).toMatchObject({ outcome: "variation-review" });
    }
  });
  it("retains the existing job-booking result for JOB payments", async () => {
    const f = fixture({ kind: "JOB", status: "PAID", variation: null });
    expect(await loadPaymentCompletion(f.db, "owner", "payment")).toEqual({ jobId: "job", outcome: "booked" });
  });
});
describe("kind-aware existing checkout and result", () => {
  it("uses the approved extra-work amount/action and no booking handoff", () => {
    const html = renderToStaticMarkup(<CheckoutPage summary={{ kind: "VARIATION", title: "Sub wiring", jobNumber: 1005, suburb: "Windsor", amountCents: 14800, gstCents: 1930, variationDescription: "A new breaker" }} testMode>
      <PayFormView kind="VARIATION" state="succeeded" amountCents={14800} />
    </CheckoutPage>);
    expect(html).toContain("Extra work"); expect(html).toContain("Approve &amp; pay $148.00"); expect(html).toContain("A new breaker");
    expect(html).toContain("Checking extra work approval."); expect(html).not.toMatch(/Pay &amp; book|your booking|finding someone local/);
  });
  it("shows no go-ahead for pending settlement or a paid office-review payment", () => {
    for (const outcome of ["variation-checking", "variation-review"] as const) {
      const html = renderToStaticMarkup(<PaymentDone completion={{ jobId: "job", outcome }} />);
      expect(html).not.toMatch(/You’re booked|finding someone local|go ahead|Extra work approved/);
      expect(html).toContain(outcome === "variation-review" ? "hasn’t been approved" : "hasn’t been told to start");
      expect(html).toContain('href="/jobs/job"');
    }
    expect(renderToStaticMarkup(<PaymentDone completion={{ jobId: "job", outcome: "variation-approved" }} />)).toContain("go ahead");
  });
});
