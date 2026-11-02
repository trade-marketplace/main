"use server";

import { revalidatePath } from "next/cache";

import { type ProfileResult, readProfileForm } from "@/lib/account/profile";
import { withRole } from "@/server/auth/guard";

import { saveProfile } from "./profile";
import { prismaProfileStore } from "./profile-store";

/**
 * Saves the name and mobile of the signed-in customer or tradie. The person comes only from the checked session:
 * a user id, role or email in the form is never read, so nobody can write another person's profile. Signed out →
 * `session-expired`, the office → `forbidden`, and the form keeps what was typed (see withRole).
 */
export const saveProfileAction = withRole(["CUSTOMER", "TRADIE"], async (viewer, _previous: ProfileResult | null, form: FormData): Promise<ProfileResult> => {
  const result = await saveProfile(prismaProfileStore(), viewer.userId, readProfileForm(form));
  // The app bar's avatar and menu use the name.
  if (result.ok) revalidatePath("/", "layout");
  return result;
});
