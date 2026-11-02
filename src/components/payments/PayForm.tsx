"use client";
// The real pay form (#151): Stripe's Payment Element (cards, Apple Pay and Google Pay, from the methods switched on in
// the Stripe dashboard, "dynamic payment methods"; Link stays on). The secret comes from the server when the form opens;
// the amount is never sent from here. Stripe takes the card details itself, they never touch our server.
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe, type Appearance, type Stripe, type StripeElementsOptions } from "@stripe/stripe-js";
import { useEffect, useMemo, useState } from "react";

import { payDonePath } from "@/lib/payments/results";
import { preparePaymentAction } from "@/server/payments/actions";

import { PayFormView, type PayState } from "./PayFormView";

type Props = { paymentId: string; amountCents: number; publishableKey: string };

export function PayForm({ paymentId, amountCents, publishableKey }: Props) {
  const stripePromise = useMemo<Promise<Stripe | null>>(() => loadStripe(publishableKey), [publishableKey]);
  const [secret, setSecret] = useState<string | null>(null);
  const [state, setState] = useState<PayState>("loading");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void preparePaymentAction(paymentId)
      .then((result) => {
        if (!live) return;
        if (!result.ok) {
          setMessage("message" in result ? result.message : "Please sign in again.");
          setState("error" in result && result.error === "not-configured" ? "not-configured" : "failed");
        } else if (result.paid) {
          window.location.assign(payDonePath(paymentId));
        } else {
          setSecret(result.clientSecret);
          setState("ready");
        }
      })
      .catch(() => {
        if (!live) return;
        setMessage("Couldn’t reach the payment service. Nothing has been charged. Try again.");
        setState("failed");
      });
    return () => {
      live = false;
    };
  }, [paymentId]);

  if (!secret) return <PayFormView state={state} amountCents={amountCents} message={message} />;
  return (
    <Elements stripe={stripePromise} options={{ clientSecret: secret, appearance: tokenAppearance(), fonts: tradeFonts() }}>
      <Confirm paymentId={paymentId} amountCents={amountCents} initial={state} initialMessage={message} />
    </Elements>
  );
}

// Stripe's fields live in its own frame, so they can't read our CSS. Hand them the design tokens' current values
// (C10: "the provider's hosted fields, styled with our field tokens").
function tokenAppearance(): Appearance {
  const css = typeof window === "undefined" ? null : getComputedStyle(document.documentElement);
  const token = (name: string) => css?.getPropertyValue(name).trim() || undefined;
  return {
    theme: "stripe",
    labels: "above",
    variables: {
      fontFamily: "'Trade UI', system-ui, sans-serif",
      fontSizeBase: "16px",
      colorPrimary: token("--trade-forest"),
      colorText: token("--trade-text"),
      colorTextSecondary: token("--trade-text-2"),
      colorBackground: token("--trade-surface"),
      colorDanger: token("--trade-danger"),
      borderRadius: token("--trade-radius-field") ?? "0px",
      spacingUnit: "4px",
    },
    rules: {
      ".Label": { fontWeight: "700", fontSize: "14px", color: token("--trade-text") ?? "" },
      ".Input": { borderColor: token("--trade-field-border") ?? "", boxShadow: "none", padding: "13px 12px" },
      ".Input:focus": { borderColor: token("--trade-forest") ?? "", boxShadow: `0 0 0 2px ${token("--trade-signature") ?? "transparent"}` },
      ".Tab": { borderColor: token("--trade-line") ?? "", boxShadow: "none" },
      ".Tab--selected": { borderColor: token("--trade-forest") ?? "", boxShadow: `inset 0 0 0 1px ${token("--trade-forest") ?? ""}` },
    },
  };
}

function tradeFonts(): StripeElementsOptions["fonts"] {
  if (typeof window === "undefined") return [];
  return [{ family: "Trade UI", src: `url(${window.location.origin}/fonts/roboto-flex/RobotoFlex.woff2)`, weight: "100 1000", display: "swap" }];
}

function Confirm({ paymentId, amountCents, initial, initialMessage }: { paymentId: string; amountCents: number; initial: PayState; initialMessage: string | null }) {
  const stripe = useStripe();
  const elements = useElements();
  const [state, setState] = useState<PayState>(initial);
  const [message, setMessage] = useState<string | null>(initialMessage);

  async function pay() {
    if (!stripe || !elements) return;
    setState("processing");
    setMessage(null);
    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: `${window.location.origin}${payDonePath(paymentId)}` },
      redirect: "if_required",
    });
    if (error) {
      // Declined, wrong details: stay on the form, with Stripe's own words, and keep what was picked.
      setMessage(error.message ?? "Check your details or try another way to pay.");
      setState("failed");
      return;
    }
    setState("succeeded");
    window.location.assign(payDonePath(paymentId));
  }

  return (
    <PayFormView state={stripe && elements ? state : "loading"} amountCents={amountCents} message={message} onSubmit={pay}>
      <PaymentElement />
    </PayFormView>
  );
}
