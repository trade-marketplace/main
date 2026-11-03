// What the payment server actions answer, and the words for each answer (#151). Safe on server and browser.
// The copy here is a first draft for Matt's review: the spec only gives "Pay & book", the test-mode banner and the
// "declined / processing / 3-D Secure" states, not the error wording.

export type PaymentErrorCode =
  /** No Stripe keys yet, or a live key is locked out. Nothing was charged. */
  | "not-configured"
  /** Not their payment, or it doesn't exist. */
  | "not-found"
  /** The job or payment isn't at a stage where it can be paid (e.g. the price was declined or the job cancelled). */
  | "not-payable"
  /** Already paid: nothing more to do. */
  | "already-paid"
  /** Stripe or the database didn't answer. Nothing was charged. */
  | "unavailable";

export const PAYMENT_ERROR_MESSAGES: Readonly<Record<PaymentErrorCode, string>> = {
  "not-configured": "Payments aren’t switched on yet. Nothing has been charged.",
  "not-found": "We couldn’t find that payment.",
  "not-payable": "This can’t be paid right now. Open the job to see where it’s up to.",
  "already-paid": "This is already paid.",
  unavailable: "Couldn’t reach the payment service. Nothing has been charged. Try again.",
};

export type PaymentFailure = { ok: false; error: PaymentErrorCode; message: string };

export const paymentFailure = (error: PaymentErrorCode): PaymentFailure => ({
  ok: false,
  error,
  message: PAYMENT_ERROR_MESSAGES[error],
});

/** Starting a payment for a job (or its extra work): the payment to open the checkout for. */
export type StartPaymentResult = { ok: true; paymentId: string; href: string } | PaymentFailure;

/** Getting the card form ready: the secret the Payment Element needs, or "already paid". */
export type PreparePaymentResult =
  | { ok: true; paid: false; clientSecret: string }
  | { ok: true; paid: true }
  | PaymentFailure;

export const payPath = (paymentId: string) => `/pay/${paymentId}`;
export const payDonePath = (paymentId: string) => `/pay/${paymentId}/done`;

/** The pay form and the Pay button (which sits in the order summary, C10) are joined by these ids. */
export const PAY_FORM_ID = "pay-form";
export const PAY_ACTION_ID = "pay-action";
