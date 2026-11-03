"use client";
// The pay form's look and states (#151), apart from Stripe so it can be previewed and tested without keys:
// /dev/components/pay shows each state with a mocked card field. States (WEBAPP_SPEC C10): loading, ready,
// processing (button spinner, page locked), failed/declined (alert banner at top, method kept), succeeded,
// not configured. Words are from docs/design/pages.html (checkout); the error wording is a draft for Matt.
import { type FormEvent, type ReactNode, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { Skeleton } from "@/components/feedback";
import { Banner } from "@/components/overlays/Banner";
import { money } from "@/lib/office-job";
import { PAY_ACTION_ID, PAY_FORM_ID } from "@/lib/payments/results";

import styles from "./payments.module.css";

export type PayState = "loading" | "ready" | "processing" | "failed" | "succeeded" | "not-configured";

export type PayFormViewProps = {
  kind?: "JOB" | "VARIATION" | "QUICK_LOOK";
  state: PayState;
  amountCents: number;
  /** Stripe's own message for a declined card, or ours. Shown at the top while state is "failed". */
  message?: string | null;
  /** The card fields: Stripe's Payment Element, or a mock in the preview. */
  children?: ReactNode;
  /** One-tap wallet buttons (Apple Pay, Google Pay) shown above the card form, as most checkouts do. */
  express?: ReactNode;
  /** Whether this device has a wallet to show (until Stripe says so, the buttons stay out of sight). */
  expressReady?: boolean;
  onSubmit?: () => void;
};

export function PayFormView({ kind = "JOB", state, amountCents, message, children, express, expressReady = false, onSubmit }: PayFormViewProps) {
  const locked = state === "processing" || state === "succeeded";
  // The Pay button lives in the order summary (C10). It submits this form through the form attribute. Without a
  // summary on the page (or before the browser takes over) it stays under the fields.
  const slot = useSyncExternalStore(noSubscribe, findActionSlot, noSlot);
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

  const action = (
    <>
      <Button type="submit" form={PAY_FORM_ID} width="full" icon="lock" loading={state === "processing"} disabled={state === "loading" || state === "succeeded" ? "Hang on a moment" : undefined}>
        {kind === "VARIATION" ? "Approve & pay" : "Pay"} {money(amountCents)}
      </Button>
      <p className={styles.reassure}>You’ll get a receipt by email. Something wrong later? We sort it.</p>
    </>
  );

  return (
    <>
    {slot && createPortal(action, slot)}
    <form id={PAY_FORM_ID} className={styles.form} onSubmit={submit} aria-busy={state === "loading" || state === "processing"}>
      {state === "failed" && (
        <Banner tone="alert" title="Payment didn’t go through." live>
          {message || "Check your details or try another way to pay."}
        </Banner>
      )}
      {state === "succeeded" && (
        <Banner tone="good" title="Paid." live>
          {kind === "VARIATION" ? "Checking extra work approval." : "Taking you to your booking."}
        </Banner>
      )}
      <fieldset className={styles.fields} disabled={locked}>
        <legend className={styles.legend}>Pay with</legend>
        {express && (
          <div className={expressReady ? styles.express : styles.expressPending} aria-hidden={expressReady ? undefined : true}>
            {express}
          </div>
        )}
        {express && expressReady && (
          <p className={styles.divider}>
            <span>Or pay with card</span>
          </p>
        )}
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
      <p className={styles.secured}>
        <Icon name="lock" size="sm" decorative fill />
        Secured by Stripe. We never see your card details.
      </p>
      {!slot && action}
    </form>
    </>
  );
}

const noSubscribe = () => () => {};
const findActionSlot = () => document.getElementById(PAY_ACTION_ID);
const noSlot = () => null;
