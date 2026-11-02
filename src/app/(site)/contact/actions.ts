"use server";

import { CONTACT_HONEYPOT, sendContact } from "@/server/contact";
import { consumeForClient } from "@/server/rate-limit";

export async function sendContactMessage(form: FormData) {
  const limit = await consumeForClient("contact");
  if (!limit.allowed) return { status: "error" as const, retryAfter: limit.retryAfter };
  return sendContact({ topic: form.get("topic"), email: form.get("email"), message: form.get("message") }, form.get(CONTACT_HONEYPOT));
}
