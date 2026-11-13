"use server";

import { z } from "zod";
import { jobDraftSchema, POST_KEY_SCHEMA } from "@/lib/job-draft";
import { listAddresses } from "@/server/account/addresses";
import { saveDraft } from "./drafts";
import { withRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";

/** A stale device envelope cannot turn an already-posted key into a new job. Nothing reveals a foreign key. */
export const inspectPostKeyAction = withRole(["CUSTOMER"], async (viewer, expectedOwnerId: string, postKey: string, restart = false, requireVerified = false) => {
  if (viewer.userId !== expectedOwnerId || !z.boolean().safeParse(restart).success || !z.boolean().safeParse(requireVerified).success) return { status: "unknown" } as const;
  const key = POST_KEY_SCHEMA.safeParse(postKey);
  if (!key.success) return { status: "unknown" } as const;
  try {
    return await getDb().$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`draft:${viewer.userId}`}, 0))`;
      const profile = await tx.profile.findUnique({ where: { id: viewer.userId }, select: { role: true, emailVerifiedAt: true } });
      if (profile?.role !== "CUSTOMER") return { status: "unknown" } as const;
      if (requireVerified && !profile.emailVerifiedAt) return { status: "unverified" } as const;
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


/** Optional choices in the public wizard: guests and other roles retain today's address step. */
export const listDraftAddressesAction = withRole(["CUSTOMER"], async (viewer) => {
  try { return { status: "loaded", addresses: await listAddresses(getDb(), viewer), ownerId: viewer.userId } as const; }
  catch { return { status: "unavailable" } as const; }
});

/** Only the saved row ID crosses from the browser for its address facts. Keep owner/key CAS intact. */
export const copyDraftAddressAction = withRole(["CUSTOMER"], async (viewer, savedAddressId: string, postKey: string, ownerId: string) => {
  if (viewer.userId !== ownerId) return { status: "forbidden" } as const;
  if (!POST_KEY_SCHEMA.safeParse(postKey).success || !z.uuid().safeParse(savedAddressId).success) return { status: "invalid" } as const;
  try {
    const result = await saveDraft(getDb(), viewer, {}, { wizardStep: "where", savedAddressId, expectedPostKey: postKey });
    if (result.status !== "saved") return result;
    const data = result.draft;
    return { status: "saved", address: { addressLine1: data.addressLine1!, addressLine2: data.addressLine2, suburb: data.suburb!, city: data.city!, postcode: data.postcode, locationSource: data.locationSource!, point: data.point } } as const;
  } catch { return { status: "unavailable" } as const; }
});
