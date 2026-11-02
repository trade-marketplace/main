"use client";
// The pay form's look and states (#151), apart from Stripe so it can be previewed and tested without keys:
// /dev/components/pay shows each state with a mocked card field. States (WEBAPP_SPEC C10): loading, ready,
// processing (button spinner, page locked), failed/declined (alert banner at top, method kept), succeeded,
// not configured. Words are from docs/design/pages.html (checkout); the error wording is a draft for Matt.
import type { FormEvent, ReactNode } from "react";

import { Button } from "@/components/Button";
import { Skeleton } from "@/components/feedback";
import { Banner } from "@/components/overlays/Banner";
import { money } from "@/lib/office-job";

import styles from "./payments.module.css";

export type PayState = "loading" | "ready" | "processing" | "failed" | "succeeded" | "not-configured";

export type PayFormViewProps = {
  state: PayState;
  amountCents: number;
  /** Stripe's own message for a declined card, or ours. Shown at the top while state is "failed". */
  message?: string | null;
  /** The card fields: Stripe's Payment Element, or a mock in the preview. */
  children?: ReactNode;
  onSubmit?: () => void;
};

export function PayFormView({ state, amountCents, message, children, onSubmit }: PayFormViewProps) {
  const locked = state === "processing" || state === "succeeded";
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (state === "ready" || state === "failed") onSubmit?.();
  };

  if (state === "not-configured") {
    return (
      <Banner tone="alert" title="Payments aren’t switched on yet.">
        Nothing has been charged. Come back soon.
      </Banner>
    );
  }

  return (
    <form className={styles.form} onSubmit={submit} aria-busy={state === "loading" || state === "processing"}>
      {state === "failed" && (
        <Banner tone="alert" title="Payment didn’t go through." live>
          {message || "Check your details or try another way to pay."}
        </Banner>
      )}
      {state === "succeeded" && (
        <Banner tone="good" title="Paid." live>
          Taking you to your booking.
        </Banner>
      )}
      <fieldset className={styles.fields} disabled={locked}>
        <legend className={styles.legend}>Pay with</legend>
        {state === "loading" ? (
          <div className={styles.skeleton} role="status" aria-label="Loading the payment form">
            <Skeleton height={55} />
            <Skeleton height={55} />
            <Skeleton height={55} />
          </div>
        ) : (
          children
        )}
      </fieldset>
      <Button type="submit" icon="lock" loading={state === "processing"} disabled={state === "loading" || state === "succeeded" ? "Hang on a moment" : undefined}>
        Pay {money(amountCents)}
      </Button>
      <p className={styles.reassure}>You’ll get a receipt by email. Something wrong later? We sort it.</p>
    </form>
  );
}
