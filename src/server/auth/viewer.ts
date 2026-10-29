import "server-only";

import { cache } from "react";

import { DatabaseNotConfiguredError, getDb } from "@/server/db";
import { createSupabaseServerClient } from "@/server/supabase";
import { SupabaseNotConfiguredError } from "@/lib/supabase/config";
import type { Role } from "@/lib/mode";

/** The signed-in person, as the server knows them. Role always comes from our `profiles` table. */
export type Viewer = {
  userId: string;
  email: string;
  role: Role;
  firstName: string;
  emailVerified: boolean;
};

export type ProfileRow = {
  id: string;
  email: string;
  role: Role;
  firstName: string;
  emailVerifiedAt: Date | null;
};

/** Where a viewer comes from. Swapped for fakes in tests, so no test talks to Supabase or a database. */
export type ViewerSources = {
  /** The Supabase Auth user id from a verified session, or null when signed out / the session is gone. */
  readUserId: () => Promise<string | null>;
  findProfile: (userId: string) => Promise<ProfileRow | null>;
};

export const PROFILE_SELECT = { id: true, email: true, role: true, firstName: true, emailVerifiedAt: true } as const;

export async function findProfile(userId: string): Promise<ProfileRow | null> {
  return getDb().profile.findUnique({ where: { id: userId }, select: PROFILE_SELECT });
}

/**
 * Reads the session from the request's cookies and checks it with Supabase Auth. `getUser()` rejects revoked
 * sessions immediately, including access tokens that have not expired after a password reset.
 */
export async function readUserIdFromCookies(): Promise<string | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();
    return !error && typeof data.user?.id === "string" ? data.user.id : null;
  } catch (error) {
    // Sign-in isn't set up yet (no Supabase keys): everyone is signed out.
    if (error instanceof SupabaseNotConfiguredError) return null;
    throw error;
  }
}

export async function loadViewer(sources: ViewerSources): Promise<Viewer | null> {
  const userId = await sources.readUserId();
  if (!userId) return null;
  let profile: ProfileRow | null;
  try {
    profile = await sources.findProfile(userId);
  } catch (error) {
    if (!(error instanceof DatabaseNotConfiguredError)) throw error;
    console.error(`Signed-in visitor treated as signed out: ${error.message}`);
    return null;
  }
  // Signed in to Supabase but no profile (sign-up was cut off halfway): signed out until they log in again,
  // which creates the profile (src/server/auth/account.ts).
  if (!profile) return null;
  return {
    userId: profile.id,
    email: profile.email,
    role: profile.role,
    firstName: profile.firstName,
    emailVerified: profile.emailVerifiedAt !== null,
  };
}

/**
 * The current visitor, or null when signed out. Cached for one request: the layout, the page and every action
 * guard can all call it and only one session check and one profile read happen.
 */
export const getViewer = cache(
  (): Promise<Viewer | null> => loadViewer({ readUserId: readUserIdFromCookies, findProfile }),
);
