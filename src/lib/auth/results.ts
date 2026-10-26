// What a protected server action returns when the visitor may not run it (#101). Safe on server and browser:
// actions return these, and client code checks them.
//
// Protected actions never redirect when the session is gone. A redirect would throw away whatever the person had
// typed; returning "session-expired" lets the page keep the form and show the session-expired dialog (B07, #108)
// over it. See docs/ARCHITECTURE.md, "Sign-in, sessions and roles".

/** The visitor's session is gone (expired, logged out in another tab, or never signed in). */
export type SessionExpired = {
  ok: false;
  error: "session-expired";
  /** What the form held when it was sent (no passwords or files), so it can be filled in again. */
  values: Record<string, string>;
};

/** Signed in, but this role may not do this (e.g. a tradie calling a customer-only action). */
export type Forbidden = { ok: false; error: "forbidden" };

export type AuthFailure = SessionExpired | Forbidden;

export function isSessionExpired(result: unknown): result is SessionExpired {
  return (
    typeof result === "object" &&
    result !== null &&
    (result as { ok?: unknown }).ok === false &&
    (result as { error?: unknown }).error === "session-expired"
  );
}

export function isForbidden(result: unknown): result is Forbidden {
  return (
    typeof result === "object" &&
    result !== null &&
    (result as { ok?: unknown }).ok === false &&
    (result as { error?: unknown }).error === "forbidden"
  );
}

// Never echoed back: anything that looks like a password, or a framework field.
const SECRET_FIELD = /password|passcode|secret|token|^otp$|^code$/i;

/**
 * The text fields of a submitted form, for putting back into it. React resets a `<form action>` after it's
 * sent, so a page that wants to keep the values passes these as each field's `defaultValue`. Leaves out
 * passwords, files and Next.js's own `$ACTION_…` fields. Repeated names (checkbox groups) keep every value,
 * joined with commas.
 */
export function keptFormValues(formData: FormData | null | undefined): Record<string, string> {
  const values: Record<string, string> = {};
  if (!formData) return values;
  for (const [name, value] of formData.entries()) {
    if (typeof value !== "string" || name.startsWith("$") || SECRET_FIELD.test(name)) continue;
    values[name] = name in values ? `${values[name]},${value}` : value;
  }
  return values;
}
