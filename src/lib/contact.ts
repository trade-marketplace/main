import { z } from "zod";

// The Contact form (A09, #215). Safe on server and browser.

/** "What’s it about?" Each one reaches the same office inbox; the topic is the email's subject line. */
export const CONTACT_TOPICS = [
  { value: "job", label: "A job I posted" },
  { value: "tradie", label: "Working as a tradie" },
  { value: "payments", label: "Payments" },
  { value: "account", label: "My account" },
  { value: "other", label: "Something else" },
] as const;
export type ContactTopic = (typeof CONTACT_TOPICS)[number]["value"];
export const DEFAULT_CONTACT_TOPIC: ContactTopic = "job";

export const CONTACT_MESSAGE_MAX = 2000;
export const CONTACT_EMAIL_MAX = 254;

export function contactTopicLabel(topic: ContactTopic): string {
  return CONTACT_TOPICS.find((item) => item.value === topic)?.label ?? "Something else";
}

const topic = z.enum(CONTACT_TOPICS.map((item) => item.value) as [ContactTopic, ...ContactTopic[]]);
// Newlines are fine in a message; other control characters are not.
const message = z.string().trim().min(1).max(CONTACT_MESSAGE_MAX).refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value));

export const contactInput = z.object({
  topic,
  email: z.string().trim().toLowerCase().max(CONTACT_EMAIL_MAX).email(),
  message,
});
export type ContactInput = z.infer<typeof contactInput>;

export type ContactField = "topic" | "email" | "message";
export type ContactResult =
  | { status: "sent" }
  | { status: "error"; field?: ContactField; /** Seconds until a rate limit lets them in again (#111). */ retryAfter?: number };
export type ContactState = "empty" | "sending" | "sent" | "error" | "offline";

/** The first field the schema rejected, for the form to show and focus. */
export function contactErrorField(error: z.ZodError): ContactField | undefined {
  const field = error.issues[0]?.path[0];
  return field === "topic" || field === "email" || field === "message" ? field : undefined;
}
