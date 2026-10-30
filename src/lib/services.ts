import { z } from "zod";

import { CATEGORIES, type Category } from "./cards";
import type { Coverage } from "./geo/coverage";
import type { LandingReview } from "./landing";
import { waitlistInput } from "./waitlist";

export type ServiceJob = { name: string; icon: string; custom?: boolean };
export type ServiceContent = {
  category: Category;
  headline: string;
  intro: string;
  popularHeading: string;
  live: boolean;
  heroImage?: string;
  jobs: ServiceJob[];
};
export type ServiceData = ServiceContent & {
  coverage: Coverage;
  reviews: LandingReview[];
  reviewsUnavailable?: boolean;
};
export const serviceWaitlistInput = waitlistInput.extend({ trade: z.enum(CATEGORIES) });
export type ServicePreviewState = "live" | "empty" | "loading" | "error" | "reviews" | "reviews-error" | "coming-soon" | "sending" | "joined" | "already-on-list" | "waitlist-error" | "offline";
export const SERVICE_PREVIEW_STATES: ServicePreviewState[] = ["live", "empty", "loading", "error", "reviews", "reviews-error", "coming-soon", "sending", "joined", "already-on-list", "waitlist-error", "offline"];

/** A named job replaces the description; Something else keeps what the visitor has already typed. */
export function serviceDescription(job: ServiceJob, entered: string): string {
  return job.custom ? entered : job.name;
}
