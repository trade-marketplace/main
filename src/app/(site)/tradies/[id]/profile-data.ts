import { cache } from "react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/server/db";
import { loadPublicProfile } from "@/server/workers/public-profile";

export const profileFor = cache(async (id: string) => {
  if (!z.uuid().safeParse(id).success || !process.env.DATABASE_URL?.trim()) notFound();
  const profile = await loadPublicProfile(getDb(), id);
  if (!profile) notFound();
  return profile;
});
