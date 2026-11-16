import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import type { JobDraft } from "@/lib/job-draft";
import type { Viewer } from "@/server/auth/viewer";
import { saveDraft } from "./drafts";

export type PostAgainResult = { status: "ready" | "draft-exists" | "forbidden" | "unavailable" };

/** Whether this job closed because its price went unanswered for 7 days (#508): only those offer Post again. */
export async function priceExpired(db: Pick<PrismaClient, "auditLog">, jobId: string): Promise<boolean> {
  return Boolean(await db.auditLog.findFirst({ where: { recordType: "jobs", recordId: jobId, action: "job.price_expired" }, select: { id: true } }));
}

/**
 * "Post again" on a job whose price expired: a new Post a job draft with the same wording, trade and address.
 * Photos and times are added again (DECISIONS.md, Price expiry). A draft the customer already has is only replaced
 * when they say so.
 */
export async function postAgain(db: PrismaClient, viewer: Viewer, id: unknown, replace: boolean): Promise<PostAgainResult> {
  if (viewer.role !== "CUSTOMER" || !z.uuid().safeParse(id).success) return { status: "forbidden" };
  const jobId = id as string;
  try {
    const job = await db.job.findFirst({ where: { id: jobId, customerId: viewer.userId, status: "CANCELLED" }, select: {
      description: true, category: true, addressLine1: true, addressLine2: true, suburb: true, city: true, postcode: true,
      lat: true, lng: true, locationSource: true, accessNotes: true } });
    if (!job || !await priceExpired(db, jobId)) return { status: "forbidden" };
    const located = job.locationSource && job.locationSource !== "TYPED" && job.lat !== null && job.lng !== null;
    const draft: JobDraft = {
      postKey: randomUUID(), description: job.description, category: job.category,
      addressLine1: job.addressLine1, ...(job.addressLine2 ? { addressLine2: job.addressLine2 } : {}), suburb: job.suburb, city: job.city,
      ...(job.postcode ? { postcode: job.postcode } : {}), ...(job.accessNotes ? { accessNotes: job.accessNotes } : {}),
      // A job posted before locations were kept, or typed by hand, keeps its address text; the location is found again.
      ...(job.locationSource === "TYPED" ? { locationSource: "TYPED" as const } : located ? { locationSource: job.locationSource!, point: { lat: job.lat!, lng: job.lng! } } : {}),
    };
    const saved = await saveDraft(db, viewer, draft, { fullSnapshot: true, expectedDraftAbsent: !replace });
    if (saved.status === "draft-changed") return { status: "draft-exists" };
    return { status: saved.status === "saved" ? "ready" : saved.status === "forbidden" ? "forbidden" : "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}
