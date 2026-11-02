"use server";

import { consumeForClient } from "@/server/rate-limit";
import { saveWaitlist } from "@/server/waitlist";

export async function joinWaitlist(form: FormData) {
  const limit = await consumeForClient("areaWaitlist");
  if (!limit.allowed) return { status: "error" as const, retryAfter: limit.retryAfter };
  return saveWaitlist({ email: form.get("email"), suburb: form.get("suburb") });
}
