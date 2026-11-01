"use server";

import { saveServiceWaitlist } from "@/server/services";

export async function joinServiceWaitlist(form: FormData) {
  return saveServiceWaitlist({ email: form.get("email"), suburb: form.get("suburb"), trade: form.get("trade") });
}
