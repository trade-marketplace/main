"use server";

import { consumeForClient } from "@/server/rate-limit";
import { saveServiceWaitlist } from "@/server/services";

export async function joinServiceWaitlist(form: FormData) {
  const limit = await consumeForClient("serviceWaitlist");
  if (!limit.allowed) return { status: "error" as const, retryAfter: limit.retryAfter };
  return saveServiceWaitlist({ email: form.get("email"), suburb: form.get("suburb"), trade: form.get("trade") });
}
