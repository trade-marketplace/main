import { z } from "zod";

import { LANDING_LOCATION_MAX } from "./landing";

const suburb = z.string().trim().min(1).max(LANDING_LOCATION_MAX).refine((value) => !/[\u0000-\u001f\u007f]/u.test(value));
export const waitlistInput = z.object({
  email: z.string().trim().toLowerCase().max(254).email(),
  suburb,
});
export type WaitlistInput = z.infer<typeof waitlistInput>;
export type WaitlistResult =
  | { status: "joined" | "already-on-list" }
  | { status: "error"; field?: "email" | "suburb" };
export type WaitlistState = "empty" | "loading" | "joined" | "already-on-list" | "error" | "offline";

/** jobStartPath passes location, description, type and coordinates. Only the bounded location belongs here. */
export function waitlistLocation(params: Record<string, string | string[] | undefined>): string {
  const parsed = suburb.safeParse(params.location);
  return parsed.success ? parsed.data : "";
}

export function suburbKey(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-NZ");
}

/** Never share an email, exact coordinates or a private job description. */
export function waitlistSharePath(location: string): string {
  const parsed = suburb.safeParse(location);
  return parsed.success ? `/coming-soon?${new URLSearchParams({ location: parsed.data })}` : "/coming-soon";
}
