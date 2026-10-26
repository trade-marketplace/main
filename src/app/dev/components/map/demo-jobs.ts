import "server-only";

// Example jobs for /dev/components/map (#82). Every name, price and place is an example, not real data.
//
// Each job has a real point and an approximate pin made by approximatePin() (#97), exactly as saving a job's
// location does. Where a pin goes is decided by jobPinFor(): the approximate pin for everyone except the worker
// who claimed the job. The preview uses a fixed random sequence so the pins don't move between screenshots;
// the app uses the secure random default.
import { haversineKm, type Point } from "@/lib/geo/distance";
import type { MapJob } from "@/lib/map/pins";
import { approximatePin, type Random } from "@/server/geo/approximate";
import { jobPinFor } from "@/server/geo/job-location";

/** The signed-in tradie the preview pretends to be. */
export const DEMO_VIEWER_ID = "demo-tradie";

/** Where the demo tradie is: central Invercargill. */
export const DEMO_YOU: Point = { lat: -46.4132, lng: 168.3538 };

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const DAY = 24 * HOUR;

/** A repeatable random sequence (mulberry32), so the demo pins land in the same place every time. */
function seededRandom(seed: number): Random {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Seed = {
  id: string;
  title: string;
  suburb: string;
  trade: string;
  /** The real address's point. Never sent to a worker who hasn't claimed the job. */
  exact: Point;
  /** Who claimed it, if anyone. */
  workerId?: string;
} & (
  | { kind: "claim"; earnCents: number }
  | { kind: "estimate" }
  | { kind: "visit" }
  | { kind: "bounty"; bountyCents: number; leftMs: number }
);

const SEEDS: Seed[] = [
  { id: "TM-1005", kind: "claim", earnCents: 25920, title: "Sub wiring", suburb: "Windsor", trade: "Electrical", exact: { lat: -46.3985, lng: 168.3695 } },
  { id: "TM-1006", kind: "claim", earnCents: 41000, title: "Control panel", suburb: "Georgetown", trade: "Electrical", exact: { lat: -46.4268, lng: 168.3745 } },
  { id: "TM-1007", kind: "estimate", title: "Switchboard", suburb: "Richmond", trade: "Electrical", exact: { lat: -46.4045, lng: 168.3832 } },
  { id: "TM-1008", kind: "claim", earnCents: 9600, title: "Power point", suburb: "Glengarry", trade: "Electrical", exact: { lat: -46.3935, lng: 168.3925 } },
  { id: "TM-1009", kind: "bounty", bountyCents: 3000, leftMs: 3 * HOUR + 20 * MINUTE, title: "Hot water cylinder", suburb: "Gladstone", trade: "Plumbing", exact: { lat: -46.3925, lng: 168.3505 } },
  { id: "TM-1010", kind: "claim", earnCents: 12000, title: "Move a couch + boxes", suburb: "Rosedale", trade: "Other", exact: { lat: -46.3868, lng: 168.3675 } },
  { id: "TM-1011", kind: "visit", title: "Leaking roof valley", suburb: "Appleby", trade: "Roofing", exact: { lat: -46.4262, lng: 168.3485 } },
  { id: "TM-1012", kind: "bounty", bountyCents: 3000, leftMs: 17 * HOUR + 42 * MINUTE, title: "Bathroom extractor fan", suburb: "Hawthorndale", trade: "Electrical", exact: { lat: -46.4142, lng: 168.4005 } },
  { id: "TM-1013", kind: "bounty", bountyCents: 3000, leftMs: 42 * MINUTE, title: "Blocked stormwater drain", suburb: "Waikiwi", trade: "Drainlaying", exact: { lat: -46.3792, lng: 168.3405 } },
  {
    id: "TM-1014",
    kind: "estimate",
    title: "Replace all the guttering, downpipes and rotten fascia boards on a two-storey villa, and take the old ones away",
    suburb: "Invercargill Central Business District",
    trade: "Roofing",
    exact: { lat: -46.4105, lng: 168.3515 },
  },
  // Two jobs a street apart: at most sizes they merge into a cluster.
  { id: "TM-1015", kind: "claim", earnCents: 18500, title: "Heat pump service", suburb: "Strathern", trade: "Electrical", exact: { lat: -46.4318, lng: 168.3638 } },
  { id: "TM-1016", kind: "estimate", title: "Tap washer", suburb: "Strathern", trade: "Plumbing", exact: { lat: -46.4322, lng: 168.3652 } },
  { id: "TM-1017", kind: "bounty", bountyCents: 3000, leftMs: -2 * HOUR, title: "Fence repair", suburb: "Kew", trade: "Other", exact: { lat: -46.4405, lng: 168.3825 } },
];

/** The claimed example for the "approximate vs exact" section. */
const CLAIMED_SEED: Seed = {
  id: "TM-1004",
  kind: "claim",
  earnCents: 25920,
  title: "Sub wiring",
  suburb: "Windsor",
  trade: "Electrical",
  exact: { lat: -46.3985, lng: 168.3695 },
  workerId: DEMO_VIEWER_ID,
};

export type DemoJob = MapJob & {
  /** For the preview's explanation only: how far the shown pin is from the real address, in metres. */
  metresFromAddress: number;
};

function toMapJob(seed: Seed, index: number, now: number): DemoJob {
  const approx = approximatePin(seed.exact, seededRandom(1000 + index));
  const workerId = seed.workerId ?? null;
  const point = jobPinFor(
    { lat: seed.exact.lat, lng: seed.exact.lng, approxLat: approx.lat, approxLng: approx.lng, workerId },
    DEMO_VIEWER_ID,
  );
  if (!point) throw new Error(`demo job ${seed.id} has no pin`);
  const base = {
    id: seed.id,
    title: seed.title,
    suburb: seed.suburb,
    trade: seed.trade,
    distanceKm: Math.round(haversineKm(DEMO_YOU, point)),
    point,
    precision: workerId === DEMO_VIEWER_ID ? ("exact" as const) : ("approximate" as const),
    metresFromAddress: Math.round(haversineKm(seed.exact, point) * 1000),
  };
  switch (seed.kind) {
    case "claim":
      return { ...base, kind: "claim", earnCents: seed.earnCents };
    case "estimate":
      return { ...base, kind: "estimate" };
    case "visit":
      return { ...base, kind: "visit" };
    case "bounty":
      return { ...base, kind: "bounty", bountyCents: seed.bountyCents, endsAt: now + seed.leftMs, durationMs: DAY };
  }
}

/** The jobs on the demo map, as a tradie who hasn't claimed any of them sees them. */
export function demoJobs(now: number): DemoJob[] {
  return SEEDS.map((seed, i) => toMapJob(seed, i, now));
}

/** One job seen before claiming (approximate pin) and after (the address), for the #97 section. */
export function demoClaimPair(now: number): { before: DemoJob; after: DemoJob } {
  const { workerId: _ignored, ...unclaimed } = CLAIMED_SEED;
  void _ignored;
  return { before: toMapJob(unclaimed, 99, now), after: toMapJob(CLAIMED_SEED, 99, now) };
}
