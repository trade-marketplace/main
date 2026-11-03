import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PayFormView, type PayState } from "@/components/payments/PayFormView";

// The pay form's states (#151), without Stripe.

const html = (state: PayState, message?: string) =>
  renderToStaticMarkup(
    <PayFormView state={state} amountCents={37200} message={message}>
      <span>CARD FIELDS</span>
    </PayFormView>,
  );

describe("PayFormView", () => {
  it("ready shows the fields and a pay button with the total", () => {
    const out = html("ready");
    expect(out).toContain("CARD FIELDS");
    expect(out).toContain("Pay $372.00");
  });

  it("loading hides the fields and says it is loading", () => {
    const out = html("loading");
    expect(out).not.toContain("CARD FIELDS");
    expect(out).toContain("Loading the payment form");
  });

  it("failed keeps the fields and shows Stripe's message", () => {
    const out = html("failed", "Your card was declined.");
    expect(out).toContain("CARD FIELDS");
    expect(out).toContain("Your card was declined.");
  });

  it("processing locks the fields", () => {
    expect(html("processing")).toMatch(/<fieldset[^>]*disabled/);
  });

  it("succeeded says paid", () => {
    expect(html("succeeded")).toContain("Paid.");
  });

  it("not configured shows no form and no charge", () => {
    const out = html("not-configured");
    expect(out).not.toContain("<form");
    expect(out).toContain("Payments aren’t switched on yet.");
  });
});
