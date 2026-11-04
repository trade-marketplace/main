import "server-only";

import { randomUUID } from "node:crypto";

import { contactErrorField, contactInput, contactTopicLabel, type ContactInput, type ContactResult } from "@/lib/contact";

// Sends a Contact form message to the office inbox by email (A09, #215). Email is Resend (DECISIONS.md, #63), sent
// from hello@trademarketplace.nz. The message is not stored anywhere: it goes straight to the inbox, and neither the
// email address nor the text is logged.
//
// Needs two server-only variables (names in .env.example):
//   RESEND_API_KEY      a Resend key allowed to send from trademarketplace.nz
//   CONTACT_INBOX_EMAIL where messages go (the office support inbox)
// Without them nothing can be delivered, so the form says it couldn't send (and keeps what was typed) rather than
// pretending it worked.

export const CONTACT_SENDER = "Trade Marketplace <hello@trademarketplace.nz>";
const RESEND_URL = "https://api.resend.com/emails";

export type ContactEmail = { from: string; to: string; replyTo: string; subject: string; text: string; html?: string };
/** Delivers one email. Resolves true only when the provider accepted it. */
export type ContactMailer = (email: ContactEmail, idempotencyKey: string) => Promise<boolean>;

/** The honeypot: a field people never see, so only a bot fills it in. */
export const CONTACT_HONEYPOT = "website";

export function contactEmail(input: ContactInput, to: string): ContactEmail {
  return {
    from: CONTACT_SENDER,
    to,
    // Replying to the email goes to the person who wrote in.
    replyTo: input.email,
    // Only the fixed topic label, never anything typed, so a subject can't be forged.
    subject: `Contact form: ${contactTopicLabel(input.topic)}`,
    text: `Topic: ${contactTopicLabel(input.topic)}\nFrom: ${input.email}\n\n${input.message}\n`,
  };
}

export function resendMailer(env: Record<string, string | undefined> = process.env, fetcher: typeof fetch = fetch): ContactMailer | null {
  const key = env.RESEND_API_KEY?.trim();
  if (!key) return null;
  return async (email, idempotencyKey) => {
    const response = await fetcher(RESEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ from: email.from, to: [email.to], reply_to: email.replyTo, subject: email.subject, text: email.text, ...(email.html !== undefined ? { html: email.html } : {}) }),
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok;
  };
}

export type ContactDeps = { mailer?: ContactMailer | null; inbox?: string | undefined; newKey?: () => string };

export async function sendContact(input: unknown, honeypot: unknown = "", deps: ContactDeps = {}): Promise<ContactResult> {
  const parsed = contactInput.safeParse(input);
  if (!parsed.success) {
    const field = contactErrorField(parsed.error);
    return { status: "error", ...(field ? { field } : {}) };
  }
  // A bot filled the hidden field. Say "sent" so it learns nothing, and send nothing.
  if (typeof honeypot === "string" && honeypot.trim() !== "") return { status: "sent" };
  const mailer = deps.mailer === undefined ? resendMailer() : deps.mailer;
  const inbox = (deps.inbox === undefined ? process.env.CONTACT_INBOX_EMAIL : deps.inbox)?.trim();
  if (!mailer || !inbox) {
    console.error("Contact messages can't be sent: RESEND_API_KEY and CONTACT_INBOX_EMAIL are not both set.");
    return { status: "error" };
  }
  try {
    const delivered = await mailer(contactEmail(parsed.data, inbox), (deps.newKey ?? randomUUID)());
    if (delivered) return { status: "sent" };
  } catch {
    // Fall through. The error can carry the address or message, so it is not logged.
  }
  console.error("A contact message could not be sent.");
  return { status: "error" };
}
