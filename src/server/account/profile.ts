import "server-only";

import { formatMobile, joinName, parseProfile, type ProfileData, type ProfileInput, type ProfileResult } from "@/lib/account/profile";

// The signed-in person's own profile (#112). Every function takes the user id from the checked session, never from
// the form, and reads and writes only that one row. The email is deliberately not written here: Supabase Auth owns
// it, and changing it is done in Account > Security (src/server/auth/security.ts), which confirms the new address first.

export type ProfileRecord = {
  firstName: string;
  lastName: string | null;
  phone: string | null;
  email: string;
  avatarPath: string | null;
};

export type ProfileStore = {
  find(userId: string): Promise<ProfileRecord | null>;
  update(userId: string, data: ProfileData): Promise<void>;
};

export const PROFILE_SELECT = { firstName: true, lastName: true, phone: true, email: true, avatarPath: true } as const;

/** What the page shows: the saved values as form text. */
export function profileForm(record: Pick<ProfileRecord, "firstName" | "lastName" | "phone">): ProfileInput {
  return { name: joinName(record.firstName, record.lastName), phone: formatMobile(record.phone) };
}

export async function saveProfile(store: ProfileStore, userId: string, input: ProfileInput): Promise<ProfileResult> {
  const parsed = parseProfile(input);
  if (!parsed.ok) return { ok: false, error: "invalid", fields: parsed.fields };
  try {
    await store.update(userId, parsed.data);
  } catch {
    // Never return or log the database's message: it can hold the person's details.
    return { ok: false, error: "unavailable" };
  }
  return { ok: true, name: joinName(parsed.data.firstName, parsed.data.lastName), phone: formatMobile(parsed.data.phone) };
}
