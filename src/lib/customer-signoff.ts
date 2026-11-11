import { z } from "zod";

export const SIGNOFF_REVIEW_TAGS = ["On time", "Tidy", "Explained well", "Good value"] as const;
export const signoffReviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  tags: z.array(z.enum(SIGNOFF_REVIEW_TAGS)).max(4).transform(tags => [...new Set(tags)]),
  comment: z.string().max(1000).optional(),
}).strict();
export type SignoffReview = z.infer<typeof signoffReviewSchema>;
export type CustomerSignoff = {
  cocNumber: string | null; cocUrl: string | null; cocFileLabel: "PDF" | "Photo" | "File";
  photos: { id: string; url: string | null }[]; notes: string | null;
  submittedAt: string | null; hoursLeft: number | null; releaseAt: string | null; problemOpen: boolean; autoCompleted: boolean;
  filesUnavailable: boolean; filesRenewAfterMs: number;
};
export type SignoffResult = { status: "signed-off" | "changed" | "forbidden" | "invalid" | "unavailable" };

export function signoffHoursLeft(submittedAt: Date | null, autoReleaseHours: number, now: Date): number | null {
  return submittedAt ? Math.max(0, (submittedAt.getTime() + autoReleaseHours * 3_600_000 - now.getTime()) / 3_600_000) : null;
}
