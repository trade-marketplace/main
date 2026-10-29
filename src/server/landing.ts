import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import type { LandingReview } from "@/lib/landing";
import { getDb } from "@/server/db";

/** Public review text only (A01/A12). No hidden reviews, job details, addresses or pay data. */
export async function landingReviews(db: Pick<PrismaClient, "review"> | null = process.env.DATABASE_URL?.trim() ? getDb() : null): Promise<LandingReview[]> {
  if (!db) return [];
  try {
    const reviews = await db.review.findMany({
      where: { hiddenAt: null, comment: { not: null } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 3,
      select: { id: true, rating: true, comment: true, reviewer: { select: { firstName: true } } },
    });
    return reviews.filter((r) => r.comment?.trim()).map((r) => ({ id: r.id, rating: r.rating, comment: r.comment!, name: r.reviewer.firstName }));
  } catch { console.error("Homepage reviews unavailable"); return []; }
}

/** Founder-approved public illustration (#211), never used for a job or payment. */
export const LANDING_ILLUSTRATION_CENTS = 37200;

/** Founder-approved design placeholders (#211, 29 Oct), visibly labelled as examples. */
export const LANDING_EXAMPLE_REVIEWS: LandingReview[] = [
  { id: "example-1", rating: 5, name: "Sarah", meta: "Sub wiring · Windsor", comment: "Posted it at lunch, had a price by dinner, sparky came Thursday. Easy." },
  { id: "example-2", rating: 5, name: "Tom", meta: "Leaking tap · Richmond", comment: "Didn't have to call five plumbers. One price, done." },
  { id: "example-3", rating: 5, name: "Mere", meta: "Fence palings · Glengarry", comment: "Fence was fixed the same week. Photos of the extra bit first, which I liked." },
];
