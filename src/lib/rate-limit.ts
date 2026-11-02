// Rate limits (#111): what each limit is, and how a wait is said to a person. Safe on server and browser.
//
// These slow bots down. They never lock an account (DECISIONS.md, #340): a log-in limit counts wrong tries from one
// connection, not from one email, so nobody can lock someone else out by typing their address.

export type RateLimitPolicy = { limit: number; windowSeconds: number };

/** `limit` tries in each `windowSeconds` window. Looser for things real people do often. */
export const RATE_LIMITS = {
  /** Wrong passwords from one connection. Only wrong tries count. */
  logInFailures: { limit: 20, windowSeconds: 15 * 60 },
  signUp: { limit: 10, windowSeconds: 60 * 60 },
  passwordReset: { limit: 5, windowSeconds: 60 * 60 },
  verificationEmail: { limit: 10, windowSeconds: 60 * 60 },
  /** Suburb and place suggestions cost a Mapbox call each. */
  placeSearch: { limit: 120, windowSeconds: 10 * 60 },
  areaWaitlist: { limit: 10, windowSeconds: 60 * 60 },
  serviceWaitlist: { limit: 10, windowSeconds: 60 * 60 },
  /** Each Contact message is an email to the office, so this is tighter than the waitlists. */
  contact: { limit: 5, windowSeconds: 60 * 60 },
  helpFeedback: { limit: 30, windowSeconds: 60 * 60 },
  // Per signed-in person. Ready for the features that post jobs, add photos and send messages.
  postJob: { limit: 10, windowSeconds: 60 * 60 },
  upload: { limit: 60, windowSeconds: 60 * 60 },
  message: { limit: 60, windowSeconds: 10 * 60 },
} as const satisfies Record<string, RateLimitPolicy>;

export type RateLimitName = keyof typeof RATE_LIMITS;

/** "a minute", "5 minutes", "about an hour": when to try again. */
export function waitText(seconds: number): string {
  const s = Number.isFinite(seconds) ? Math.max(1, Math.ceil(seconds)) : 60;
  if (s <= 60) return "a minute";
  const minutes = Math.ceil(s / 60);
  if (minutes < 90) return `${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  return hours <= 1 ? "about an hour" : `about ${hours} hours`;
}

/** The sentence under "Too many tries." */
export function tryAgainText(seconds: number): string {
  return `Try again in ${waitText(seconds)}.`;
}
