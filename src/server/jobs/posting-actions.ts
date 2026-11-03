"use server";

import { z } from "zod";
import { jobDraftSchema, POST_KEY_SCHEMA } from "@/lib/job-draft";
import { withRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";

/** A stale device envelope cannot turn an already-posted key into a new job. Nothing reveals a foreign key. */
export const inspectPostKeyAction = withRole(["CUSTOMER"], async (viewer, expectedOwnerId: string, postKey: string, restart = false) => {
  if (viewer.userId !== expectedOwnerId || !z.boolean().safeParse(restart).success) return { status: "unknown" } as const;
  const key = POST_KEY_SCHEMA.safeParse(postKey);
  if (!key.success) return { status: "unknown" } as const;
  try {
    return await getDb().$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`draft:${viewer.userId}`}, 0))`;
      const profile = await tx.profile.findUnique({ where: { id: viewer.userId }, select: { role: true } });
      if (profile?.role !== "CUSTOMER") return { status: "unknown" } as const;
      const job = await tx.job.findFirst({ where: { customerId: viewer.userId, postKey: key.data }, select: { id: true, jobNumber: true } });
      if (!job) return { status: "unposted" } as const;
      if (!restart) return { status: "posted", jobId: job.id, jobNumber: job.jobNumber } as const;
      // Only the confirmed consumed key can be cleared; a different/newer owned draft survives.
      await tx.jobDraft.deleteMany({ where: { profileId: viewer.userId, data: { path: ["postKey"], equals: key.data } } });
      const current = await tx.jobDraft.findUnique({ where: { profileId: viewer.userId } });
      return { status: "fresh", initialDraft: jobDraftSchema.parse(current?.data ?? {}), hasServerDraft: Boolean(current), initialManualCategory: current?.manualCategory ?? null } as const;
    });
  } catch { return { status: "unknown" } as const; }
});
