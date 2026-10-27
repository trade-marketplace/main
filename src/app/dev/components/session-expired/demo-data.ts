// What the /dev/components/session-expired preview pretends (#108). Plain data, so the server page can read it.
import type { LogInResult } from "@/server/auth/account";

export const DEMO_EMAIL = "sarah@email.co.nz";

export const DEMO_DRAFT = "The kitchen tap drips all night. It's the mixer over the sink.";

export type PreviewOpen = "notice" | "form";

/** Each answer the log-in can give, for `?state=` and for passwords typed in the preview. */
export const PREVIEW_STATES = {
  wrong: { ok: false, error: "wrong-credentials", values: { email: DEMO_EMAIL } },
  locked: { ok: false, error: "try-later", values: { email: DEMO_EMAIL } },
  unverified: { ok: false, error: "email-not-verified", values: { email: DEMO_EMAIL } },
  invalid: { ok: false, error: "invalid", fieldErrors: { password: "Enter your password." }, values: { email: DEMO_EMAIL } },
  unavailable: { ok: false, error: "unavailable", values: { email: DEMO_EMAIL } },
} satisfies Record<string, Exclude<LogInResult, { ok: true }>>;

export type PreviewState = keyof typeof PREVIEW_STATES;
