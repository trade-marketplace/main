import "server-only";

import { readSecurityUser } from "@/server/auth/security";
import { securityDeps } from "@/server/auth/security-deps";

import { getAvatarService } from "./avatar-store";
import { profileForm, type ProfileRecord, type ProfileStore } from "./profile";
import { prismaProfileStore } from "./profile-store";

export type ProfilePageData = {
  initial: { name: string; phone: string };
  email: string;
  pendingEmail?: string;
  avatarUrl: string | null;
};

export type ProfilePageSources = {
  store: ProfileStore;
  /** The address Auth is waiting on the new inbox to confirm, if any. Failing to ask is not a reason to fail the page. */
  pendingEmail: (userId: string) => Promise<string | undefined>;
  avatarUrl: (userId: string, path: string | null) => Promise<string | null>;
};

/** Everything the profile page shows, for one person. Null when the profile can't be read (the page offers a retry). */
export async function loadProfilePage(userId: string, sources: ProfilePageSources = liveSources): Promise<ProfilePageData | null> {
  let record: ProfileRecord | null;
  try { record = await sources.store.find(userId); } catch { return null; }
  if (!record) return null;
  const [pendingEmail, avatarUrl] = await Promise.all([
    sources.pendingEmail(userId).catch(() => undefined),
    sources.avatarUrl(userId, record.avatarPath).catch(() => null),
  ]);
  return { initial: profileForm(record), email: record.email, ...(pendingEmail ? { pendingEmail } : {}), avatarUrl };
}

const liveSources: ProfilePageSources = {
  store: prismaProfileStore(),
  pendingEmail: async (userId) => (await readSecurityUser(await securityDeps(), userId))?.new_email,
  avatarUrl: (userId, path) => {
    if (!path) return Promise.resolve(null);
    try { return getAvatarService().avatarUrl(userId, path); } catch { return Promise.resolve(null); }
  },
};
