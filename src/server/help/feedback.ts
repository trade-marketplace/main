import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { helpFeedbackInput, type HelpFeedbackResult } from "@/lib/help";
import { getDb } from "@/server/db";

type Store = Pick<PrismaClient, "helpArticleFeedback">;
export async function recordHelpFeedback(input: unknown, voterKey: string, slugs: readonly string[], database: () => Store | null = () => process.env.DATABASE_URL?.trim() ? getDb() : null): Promise<HelpFeedbackResult> {
  const parsed = helpFeedbackInput.safeParse(input);
  if (!parsed.success || !slugs.includes(parsed.data.slug) || !/^[a-f0-9]{64}$/.test(voterKey)) return { status: "error" };
  try {
    const db = database();
    if (!db) return { status: "error" };
    const { slug: articleSlug, helpful, lookingFor } = parsed.data;
    const data = { helpful, lookingFor: helpful ? null : lookingFor || null };
    await db.helpArticleFeedback.upsert({ where: { articleSlug_voterKey: { articleSlug, voterKey } }, create: { articleSlug, voterKey, ...data }, update: data });
    return { status: "saved" };
  } catch {
    console.error("Help feedback could not be saved.");
    return { status: "error" };
  }
}
