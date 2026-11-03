import "server-only";

import type { PrismaClient, Prisma } from "@/generated/prisma/client";
import { draftFieldErrors, jobDraftSchema } from "@/lib/job-draft";
import type { Viewer } from "@/server/auth/viewer";

type Db = Pick<PrismaClient, "$transaction">;
type DraftOptions = {
  expectedDraftAbsent?: boolean;
  expectedPostKey?: string;
  expectedPhotoPaths?: readonly string[];
  validatePhotos?: (tx: Prisma.TransactionClient, postKey: string | undefined, paths: string[]) => Promise<boolean>;
};

export async function saveDraft(db: Db, viewer: Viewer | null, input: unknown, options: DraftOptions = {}) {
  if (!viewer) return { status: "needs-account" } as const;
  const parsed = jobDraftSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid", fields: draftFieldErrors(parsed.error) } as const;
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`draft:${viewer.userId}`}, 0))`;
    const profile = await tx.profile.findUnique({ where: { id: viewer.userId }, select: { role: true } });
    if (profile?.role !== "CUSTOMER") return { status: "forbidden" } as const;
    const previous = await tx.jobDraft.findUnique({ where: { profileId: viewer.userId } });
    if (options.expectedDraftAbsent && previous) return { status: "draft-changed" } as const;
    const old = jobDraftSchema.parse(previous?.data ?? {});
    if (options.expectedPostKey && old.postKey !== options.expectedPostKey) return { status: "forbidden" } as const;
    if (options.expectedPostKey && parsed.data.postKey && parsed.data.postKey !== options.expectedPostKey) return { status: "forbidden" } as const;
    if (options.expectedPhotoPaths && JSON.stringify(old.photoPaths ?? []) !== JSON.stringify(options.expectedPhotoPaths)) {
      return { status: "photos-changed", photoPaths: old.photoPaths ?? [] } as const;
    }
    const data = jobDraftSchema.parse({ ...((previous?.data ?? {}) as object), ...parsed.data }) as Prisma.InputJsonObject;
    if (options.validatePhotos && JSON.stringify(old.photoPaths ?? []) !== JSON.stringify(data.photoPaths ?? [])) {
      const next = jobDraftSchema.parse(data);
      if (!await options.validatePhotos(tx, next.postKey, next.photoPaths ?? [])) return { status: "invalid", fields: { photoPaths: "Add some photos" } } as const;
    }
    await tx.jobDraft.upsert({ where: { profileId: viewer.userId }, create: { profileId: viewer.userId, data }, update: { data } });
    return { status: "saved" } as const;
  }, { timeout: 30_000 });
}

export async function loadDraft(db: Db, viewer: Viewer | null) {
  if (!viewer) return null;
  return db.$transaction(async (tx) => {
    const profile = await tx.profile.findUnique({ where: { id: viewer.userId }, select: { role: true } });
    if (profile?.role !== "CUSTOMER") return null;
    const row = await tx.jobDraft.findUnique({ where: { profileId: viewer.userId } });
    return row ? jobDraftSchema.parse(row.data) : null;
  });
}
