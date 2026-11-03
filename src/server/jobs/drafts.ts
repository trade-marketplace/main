import "server-only";

import type { PrismaClient, Prisma } from "@/generated/prisma/client";
import { draftFieldErrors, jobDraftSchema } from "@/lib/job-draft";
import type { Viewer } from "@/server/auth/viewer";

type Db = Pick<PrismaClient, "$transaction">;

export async function saveDraft(db: Db, viewer: Viewer | null, input: unknown, options: { manualCategory?: boolean } = {}) {
  if (!viewer) return { status: "needs-account" } as const;
  const parsed = jobDraftSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid", fields: draftFieldErrors(parsed.error) } as const;
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`draft:${viewer.userId}`}, 0))`;
    const profile = await tx.profile.findUnique({ where: { id: viewer.userId }, select: { role: true } });
    if (profile?.role !== "CUSTOMER") return { status: "forbidden" } as const;
    const previous = await tx.jobDraft.findUnique({ where: { profileId: viewer.userId } });
    const data = jobDraftSchema.parse({ ...((previous?.data ?? {}) as object), ...parsed.data }) as Prisma.InputJsonObject;
    const old = previous?.data as Record<string, unknown> | undefined;
    const changed = old?.postKey !== data.postKey || old?.description !== data.description || old?.category !== data.category;
    const manualCategory = options.manualCategory !== undefined
      ? parsed.data.description && parsed.data.category ? options.manualCategory : null
      : changed ? null : previous?.manualCategory ?? null;
    await tx.jobDraft.upsert({ where: { profileId: viewer.userId }, create: { profileId: viewer.userId, data, manualCategory }, update: { data, manualCategory } });
    return { status: "saved" } as const;
  });
}

export async function loadWizardDraft(db: Db, viewer: Viewer | null) {
  if (!viewer) return null;
  return db.$transaction(async (tx) => {
    const profile = await tx.profile.findUnique({ where: { id: viewer.userId }, select: { role: true } });
    if (profile?.role !== "CUSTOMER") return null;
    const row = await tx.jobDraft.findUnique({ where: { profileId: viewer.userId } });
    return row ? { draft: jobDraftSchema.parse(row.data), manualCategory: row.manualCategory } : null;
  });
}

/** The shared #116 service keeps its canonical return shape. */
export async function loadDraft(db: Db, viewer: Viewer | null) {
  return (await loadWizardDraft(db, viewer))?.draft ?? null;
}
