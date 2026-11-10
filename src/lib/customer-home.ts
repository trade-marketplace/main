import type { Category } from "./cards";
import type { Coverage } from "./geo/coverage";
import type { LandingLocation } from "./landing";
import type { customerJobListView } from "@/server/views/jobs";
import type { CustomerJobAction } from "./customer-jobs";
import { customerJobHref } from "./customer-job";

export type HomeAction = CustomerJobAction;
export type HomeJob = NonNullable<ReturnType<typeof customerJobListView>> & { action: HomeAction };
export type CustomerHomeData = {
  firstName: string;
  coverage: Coverage;
  location: LandingLocation;
  outside: boolean;
  categories: readonly Category[];
  needsYou: HomeJob[];
  inProgress: HomeJob[];
  recent: HomeJob[];
  counts: { needsYou: number; inProgress: number };
};
export type CustomerHomeResult = { ok: true; data: CustomerHomeData } | { ok: false };

/** Customer home has one canonical return destination. No request value becomes an arbitrary redirect. */
export function homeJobHref(id: string): string {
  return customerJobHref(encodeURIComponent(id), "/");
}

/** These are suggested job descriptions from C01's mockup, never example customer jobs or prices. */
export const HOME_SUGGESTIONS = ["Heat pump service", "Downlights", "Leaking tap", "Hang a door", "Gutter clean"] as const;
