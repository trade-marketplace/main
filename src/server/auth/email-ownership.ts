import "server-only";

// DECISIONS.md (Matt, 27 Oct, #340): people may log in before confirming their email, but they can't post a job or
// take one (claim, quote, book, ask for extra work) until they have. `profiles.email_verified_at` is set only by our
// own ownership proof: the one-time /verify token (#106) or an exchanged email-change link. Never by Supabase's
// `email_confirmed_at`, which "Confirm email" being off sets without anyone opening a link (#353).

export type EmailOwnership = { email?: string | null; emailVerifiedAt: Date | null } | null | undefined;

/** True only for a real, past proof time on a profile that has an email. Read it inside the command's transaction. */
export function emailOwnershipProved(profile: EmailOwnership, now = new Date()): boolean {
  const at = profile?.emailVerifiedAt;
  if (profile?.email !== undefined && (typeof profile.email !== "string" || !profile.email.trim())) return false;
  return at instanceof Date && Number.isFinite(at.getTime()) && Number.isFinite(now.getTime()) && at.getTime() <= now.getTime();
}
