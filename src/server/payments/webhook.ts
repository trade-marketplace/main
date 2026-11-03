import "server-only";

import type Stripe from "stripe";

import { getStripeConfig, getStripe } from "./stripe";
import { handleStripeEvent, type EventOutcome } from "./webhook-events";
import { getDb } from "@/server/db";

// The webhook request itself (#151): checks Stripe's signature on the raw body, then hands the event on. Kept apart
// from the route file so tests can drive it with fakes: no network and no keys.
//
//   missing keys / locked live key → 503   (Stripe retries later; nothing is recorded)
//   no or wrong signature          → 400   (never processed)
//   processing threw               → 500   (Stripe retries; every handler is safe to run again)
//   everything else                → 200   (including events we ignore)

export type WebhookDeps = {
  /** The webhook signing secret, or null when payments aren't set up. */
  secret: () => string | null;
  verify: (rawBody: string, signature: string, secret: string) => Stripe.Event;
  handle: (event: Stripe.Event) => Promise<EventOutcome>;
};

const json = (body: Record<string, unknown>, status: number) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

export async function handleWebhookPost(request: Request, deps: WebhookDeps): Promise<Response> {
  const secret = deps.secret();
  if (!secret) return json({ error: "payments-not-configured" }, 503);

  const signature = request.headers.get("stripe-signature");
  if (!signature) return json({ error: "missing-signature" }, 400);

  // The raw text: the signature covers the exact bytes, so the body must not be parsed and re-written first.
  const rawBody = await request.text();
  let event: Stripe.Event;
  try {
    event = deps.verify(rawBody, signature, secret);
  } catch {
    return json({ error: "invalid-signature" }, 400);
  }

  try {
    const outcome = await deps.handle(event);
    return json({ received: true, outcome }, 200);
  } catch (error) {
    console.error("Stripe webhook: couldn't process an event.", { type: event.type, id: event.id }, error);
    return json({ error: "processing-failed" }, 500);
  }
}

/** The real thing, wired to Stripe's library and the database. */
export const liveWebhookDeps: WebhookDeps = {
  secret() {
    const config = getStripeConfig();
    return config.status === "ready" ? config.webhookSecret : null;
  },
  verify: (rawBody, signature, secret) => getStripe().webhooks.constructEvent(rawBody, signature, secret),
  handle: (event) => handleStripeEvent(getDb(), event),
};
