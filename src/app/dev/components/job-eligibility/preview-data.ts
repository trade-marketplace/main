import type { EligibilityJob, EligibilityWorker } from "@/server/workers/eligibility";

export const ELIGIBILITY_STATES = ["ready", "needs-estimate", "own-job", "paused", "email-unconfirmed", "id-unchecked", "licence-pending", "licence-expired", "wrong-trade", "outside-area", "location-unavailable", "work-area-missing"] as const;
export const PREVIEW_NOW = new Date("2026-11-03T00:00:00Z");
const checked = new Date("2026-10-01T00:00:00Z");
const CENTRE = { lat: -46.4132, lng: 168.3538 };
export function eligibilityExample(state: string): { worker: EligibilityWorker; jobs: (EligibilityJob & { title: string; suburb: string })[] } {
  const worker: EligibilityWorker = { id: "worker-example", role: "TRADIE", email: "worker@example.test", emailVerifiedAt: checked,
    workerProfile: { identityCheckedAt: checked, identityCheckedById: "office-example", pausedAt: null, baseSuburb: "Invercargill", areaLat: CENTRE.lat, areaLng: CENTRE.lng, areaRadiusKm: 25, available: true },
    workerTrades: [{ trade: "ELECTRICAL", licence: { status: "VERIFIED", checkedAt: checked, checkedById: "office-example", expiresOn: new Date("2027-11-03") } }] };
  const base = { customerId: "customer-example", workerId: null, lat: CENTRE.lat, lng: CENTRE.lng, approxLat: CENTRE.lat + 0.0015, approxLng: CENTRE.lng, suburb: "Gladstone", anyTime: true, timeWindows: [] };
  const jobs: (EligibilityJob & { title: string; suburb: string })[] = [
    { ...base, id: "socket", title: "Replace a socket", category: "ELECTRICAL", status: state === "needs-estimate" ? "REVIEW" : "BOOKABLE" },
    { ...base, id: "door", title: "Hang a door", category: "OTHER", status: "BOOKABLE" },
    { ...base, id: "light", title: "Install a new light", category: "ELECTRICAL", status: "REVIEW" },
    { ...base, id: "fault", title: "Trace a fault", category: "ELECTRICAL", status: "QUOTE_BOUNTY" },
  ];
  const profile = worker.workerProfile!, licence = worker.workerTrades[0].licence!;
  if (state === "own-job") for (const job of jobs) job.customerId = worker.id;
  if (state === "paused") profile.pausedAt = checked;
  if (state === "email-unconfirmed") worker.emailVerifiedAt = null;
  if (state === "id-unchecked") { profile.identityCheckedAt = null; profile.identityCheckedById = null; }
  if (state === "licence-pending") licence.status = "PENDING";
  if (state === "licence-expired") licence.expiresOn = new Date("2026-11-02");
  if (state === "wrong-trade") worker.workerTrades[0].trade = "PLUMBING";
  if (state === "outside-area") { profile.areaLat = -36.85; profile.areaLng = 174.76; profile.baseSuburb = "Auckland"; }
  if (state === "location-unavailable") for (const job of jobs) { job.approxLat = null; job.approxLng = null; }
  if (state === "work-area-missing") { profile.areaLat = null; profile.areaLng = null; }
  return { worker, jobs };
}
