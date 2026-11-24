// A small stand-in for Stripe's Refunds API, as tests/unit/refunds-db.test.ts fakes it (no network, no keys): each
// PaymentIntent has one charge with a running `amount_refunded`, and a key used before gets its first answer back.
// For tests that exercise the real refund path (src/server/payments/refunds.ts) without testing Stripe itself.
import { randomUUID } from "node:crypto";

import type Stripe from "stripe";

import type { RefundsApi } from "@/server/payments/refunds";

export function fakeRefunds() {
  const charges = new Map<string, { amount: number; refunded: number }>();
  const answers = new Map<string, Stripe.Refund>();
  let made = 0;
  const chargeOf = (intent: string) => {
    const charge = charges.get(intent);
    if (!charge) throw new Error(`No charge for ${intent}`);
    return charge;
  };
  const chargeObject = (intent: string) => ({ id: `ch_${intent}`, object: "charge", payment_intent: intent, amount_refunded: chargeOf(intent).refunded }) as unknown as Stripe.Charge;
  const chargeEvent = (intent: string) => ({ id: `evt_${randomUUID()}`, type: "charge.refunded", livemode: false, data: { object: chargeObject(intent) } }) as unknown as Stripe.Event;

  const api: RefundsApi = {
    async create(params, options) {
      const key = String(options.idempotencyKey);
      const replay = answers.get(key);
      if (replay) return replay;
      const intent = String(params.payment_intent);
      const charge = chargeOf(intent);
      const amount = Number(params.amount);
      if (amount > charge.amount - charge.refunded) throw Object.assign(new Error("Too much."), { type: "StripeInvalidRequestError", statusCode: 400, code: "amount_too_large" });
      charge.refunded += amount;
      const refund = { id: `re_${++made}`, object: "refund", amount, status: "succeeded", payment_intent: intent, charge: chargeObject(intent), metadata: params.metadata } as unknown as Stripe.Refund;
      answers.set(key, refund);
      return refund;
    },
    async list(params) {
      const intent = String(params.payment_intent);
      const data = [...answers.values()].filter((refund) => refund.payment_intent === intent);
      return { object: "list", data, has_more: false, url: "/v1/refunds" } as unknown as Stripe.ApiList<Stripe.Refund>;
    },
  };
  return {
    api,
    open: (intent: string, amount: number) => charges.set(intent, { amount, refunded: 0 }),
    /** Someone refunds in the Stripe dashboard: the charge.refunded event Stripe would send. */
    dashboardRefund(intent: string, amount: number) {
      chargeOf(intent).refunded += amount;
      return chargeEvent(intent);
    },
    /** The same event again (Stripe retries webhooks). */
    chargeEvent,
  };
}
