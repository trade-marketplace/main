"use server";

import { saveWaitlist } from "@/server/waitlist";

export async function joinWaitlist(form: FormData) {
  return saveWaitlist({ email: form.get("email"), suburb: form.get("suburb") });
}
