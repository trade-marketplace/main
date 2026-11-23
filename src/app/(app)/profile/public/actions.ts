"use server";
import { revalidatePath } from "next/cache";
import { withRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { saveBio, type SaveBioResult } from "@/server/workers/public-bio";

const save = withRole(["TRADIE"], async (viewer, bio: string): Promise<SaveBioResult> => {
  try {
    const result = await saveBio(getDb(), viewer, bio);
    if (result.ok) {
      revalidatePath("/profile/public");
      revalidatePath(`/tradies/${viewer.userId}`);
    }
    return result;
  } catch {
    return { ok: false, error: "unavailable" };
  }
});

export async function savePublicBio(bio: string): Promise<SaveBioResult> {
  return save(bio);
}
