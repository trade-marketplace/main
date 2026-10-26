// Map pins (#82): what each pin says, what a screen reader hears, where it sits on the map and which pins
// merge into a cluster. Pure: safe on the server and in the browser. The components are in
// src/components/map/. The map itself (Mapbox) is wired in by a later issue; until then pins sit on a
// placeholder surface and are placed with projectPoint().
import { formatKm, haversineKm, type Point } from "@/lib/geo/distance";
import { formatCountdown } from "@/lib/motion/helpers";

/**
 * The pin kinds from the design (docs/design/web.css .w-pin--*):
 * claim = ready to claim, shows what the tradie earns (Forest) · estimate = quote from the photos (white) ·
 * visit = needs a site visit, in person (action colour) · bounty = quote bounty (gold, M27).
 */
export const PIN_KINDS = ["claim", "estimate", "visit", "bounty"] as const;
export type PinKind = (typeof PIN_KINDS)[number];

/**
 * Where a pin is. Before a worker has claimed a job they only ever get the approximate pin (#97: jobPinFor()
 * in src/server/geo/job-location.ts), never the address; "exact" is only for the worker it's assigned to.
 */
export type PinPrecision = "approximate" | "exact";

type MapJobBase = {
  id: string;
  title: string;
  suburb: string;
  /** e.g. "Plumbing", "Other". */
  trade?: string;
  /** Whole km to the job's pin (distanceToJobKm()), when known. */
  distanceKm?: number | null;
  /** Always from jobPinFor(): the approximate pin unless this viewer claimed the job. */
  point: Point;
  precision: PinPrecision;
};

export type MapJob = MapJobBase &
  (
    | { kind: "claim"; /** What the tradie earns, in cents. Never the customer's price. */ earnCents: number }
    | { kind: "estimate" }
    | { kind: "visit" }
    | {
        kind: "bounty";
        /** The bounty, in cents ($30 at launch). */
        bountyCents: number;
        /** When the bounty expires (epoch ms). */
        endsAt: number;
        /** How long it ran in total (24h at launch), for the countdown ring. */
        durationMs: number;
      }
  );

/** What each kind is called, in the legend and at the start of a pin's name. */
export const KIND_NAMES: Record<PinKind, string> = {
  claim: "Ready to claim",
  estimate: "Needs an estimate",
  visit: "Needs a site visit",
  bounty: "Bounty",
};

/** Milliseconds a bounty has left at `now` (0 once expired). */
export function bountyRemainingMs(endsAt: number, now: number): number {
  return Math.max(0, endsAt - now);
}

export function isExpired(remainingMs: number): boolean {
  return !(remainingMs > 0);
}

/**
 * Time left as it's read out: "3 h left", "42 min left", "expired". Whole hours (rounded down) from 1h, so the
 * name changes once an hour rather than every minute; minutes (rounded up) under an hour.
 */
export function formatTimeLeftSpoken(remainingMs: number): string {
  if (isExpired(remainingMs)) return "expired";
  const minutes = Math.ceil(remainingMs / 60_000);
  if (minutes < 60) return `${minutes} min left`;
  return `${Math.floor(minutes / 60)} h left`;
}

/** Whole dollars for a pin ("$259"); the card and list show cents. */
export function formatPinDollars(cents: number): string {
  return `$${Math.round(cents / 100)}`;
}

// Same format as formatNzd() in src/components/motion/CountUp.tsx, which is a client module (not importable here).
const nzd = new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" });

/** $259.20: money on cards and list rows. */
export function formatCents(cents: number): string {
  return nzd.format(cents / 100);
}

/** The short text on the pin: "$259", "Estimate", "Visit", "$30 · 17h", "$30 · Expired". */
export function pinText(job: MapJob, remainingMs: number | null): string {
  switch (job.kind) {
    case "claim":
      return formatPinDollars(job.earnCents);
    case "estimate":
      return "Estimate";
    case "visit":
      return "Visit";
    case "bounty": {
      const left = remainingMs ?? job.durationMs;
      return `${formatPinDollars(job.bountyCents)} · ${isExpired(left) ? "Expired" : formatCountdown(left)}`;
    }
  }
}

/**
 * The pin's accessible name: kind, title, suburb, then what matters for that kind.
 * "Bounty: Hot water cylinder, Gladstone, 3 h left" · "Ready to claim: Sub wiring, Windsor, you earn $259.20".
 */
export function pinName(job: MapJob, remainingMs: number | null): string {
  const base = `${KIND_NAMES[job.kind]}: ${job.title}, ${job.suburb}`;
  switch (job.kind) {
    case "claim":
      return `${base}, you earn ${formatCents(job.earnCents)}`;
    case "bounty":
      return `${base}, ${formatTimeLeftSpoken(remainingMs ?? job.durationMs)}`;
    default:
      return base;
  }
}

/** The caption under a job's title: "6 km · Waikiwi · Plumbing" (whatever is known). */
export function jobCaption(job: Pick<MapJob, "distanceKm" | "suburb" | "trade">): string {
  return [job.distanceKm == null ? null : formatKm(job.distanceKm), job.suburb, job.trade].filter(Boolean).join(" · ");
}

/** What the list row and card say the tradie gets: "You earn $259.20", "Quote from photos", … */
export function jobOffer(job: MapJob, remainingMs: number | null): string {
  switch (job.kind) {
    case "claim":
      return `You earn ${formatCents(job.earnCents)}`;
    case "estimate":
      return "Quote from photos";
    case "visit":
      return "Quote in person";
    case "bounty": {
      const left = remainingMs ?? job.durationMs;
      return isExpired(left)
        ? `Bounty ${formatCents(job.bountyCents)} · expired`
        : `Bounty ${formatCents(job.bountyCents)} · ${formatCountdown(left)} left`;
    }
  }
}

/** A cluster's accessible name: "8 jobs here, 2 of them bounties. Zoom in to see them". */
export function clusterName(count: number, bounties = 0): string {
  const jobs = `${count} ${count === 1 ? "job" : "jobs"} here`;
  const gold = bounties > 0 ? `, ${bounties === count ? "all" : bounties} of them ${bounties === 1 ? "a bounty" : "bounties"}` : "";
  return `${jobs}${gold}. Zoom in to see them`;
}

/** The number on a cluster: "8", "99+". */
export function clusterText(count: number): string {
  return count > 99 ? "99+" : String(count);
}

// ---- Placing pins on the placeholder map ------------------------------------------------------------------

/** The part of the world the map shows. */
export type Bounds = { north: number; south: number; east: number; west: number };

const mercatorY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

/**
 * Where a point sits on the map, as a percentage from the left and top (Web Mercator, as Mapbox draws it).
 * Null when it's outside the bounds: it isn't drawn.
 */
export function projectPoint(point: Point, bounds: Bounds): { x: number; y: number } | null {
  if (point.lat > bounds.north || point.lat < bounds.south || point.lng < bounds.west || point.lng > bounds.east) {
    return null;
  }
  const x = ((point.lng - bounds.west) / (bounds.east - bounds.west)) * 100;
  const top = mercatorY(bounds.north);
  const y = ((top - mercatorY(point.lat)) / (top - mercatorY(bounds.south))) * 100;
  return { x, y };
}

/** Bounds around these points, with `pad` (a fraction of the span) on every side. Null with no points. */
export function boundsAround(points: readonly Point[], pad = 0.15, minSpanDeg = 0.01): Bounds | null {
  if (points.length === 0) return null;
  let north = -90;
  let south = 90;
  let east = -180;
  let west = 180;
  for (const p of points) {
    north = Math.max(north, p.lat);
    south = Math.min(south, p.lat);
    east = Math.max(east, p.lng);
    west = Math.min(west, p.lng);
  }
  const latPad = Math.max(north - south, minSpanDeg) * pad + Math.max(0, minSpanDeg - (north - south)) / 2;
  const lngPad = Math.max(east - west, minSpanDeg) * pad + Math.max(0, minSpanDeg - (east - west)) / 2;
  return { north: north + latPad, south: south - latPad, east: east + lngPad, west: west - lngPad };
}

/** How wide `metres` is as a percentage of the map's width (for the approximate-area ring). */
export function metresAsWidthPct(metres: number, bounds: Bounds): number {
  const midLat = (bounds.north + bounds.south) / 2;
  const widthKm = haversineKm({ lat: midLat, lng: bounds.west }, { lat: midLat, lng: bounds.east });
  return widthKm > 0 ? (metres / 1000 / widthKm) * 100 : 0;
}

// ---- Clustering ------------------------------------------------------------------------------------------

/** A pin placed on the map, in pixels. */
export type PlacedPin = { id: string; x: number; y: number; width: number; bounty: boolean };

export type PinGroup = { lead: PlacedPin; members: PlacedPin[] };

/** Pin height in px (the label pill). Pins hang above their point, centred on it. */
export const PIN_HEIGHT_PX = 30;
/** Space kept clear between pins so each stays a separate, easy target. */
export const PIN_GAP_PX = 4;

/**
 * Keeps a pin's label inside the map's edge (px). The placeholder map does this instead of the padding Mapbox's
 * fitBounds() will add, so a pin near the edge is never cut off.
 */
export function keepInside(pin: PlacedPin, width: number, height: number): { x: number; y: number } {
  const half = pin.width / 2 + PIN_GAP_PX;
  const x = width > half * 2 ? Math.min(Math.max(pin.x, half), width - half) : width / 2;
  const top = PIN_HEIGHT_PX + 6 + PIN_GAP_PX;
  const y = height > top + PIN_GAP_PX ? Math.min(Math.max(pin.y, top), height - PIN_GAP_PX) : height / 2;
  return { x, y };
}

/** Roughly how wide a pin is, from its text (12.5px bold, 10px padding, a 15px icon). */
export function estimatePinWidth(text: string, hasIcon: boolean): number {
  return Math.ceil(20 + text.length * 7.6 + (hasIcon ? 19 : 0));
}

function overlaps(a: PlacedPin, b: PlacedPin): boolean {
  return (
    Math.abs(a.x - b.x) < (a.width + b.width) / 2 + PIN_GAP_PX && Math.abs(a.y - b.y) < PIN_HEIGHT_PX + PIN_GAP_PX
  );
}

/**
 * Pins that would overlap on screen merge into a cluster, as Mapbox's clustering does once it's wired in.
 * Bounties are placed first, so a gold pin is never the one hidden. A group of one is a plain pin; a bigger
 * group is drawn as a cluster where its lead pin would be (a spot already clear of every other pin).
 */
export function groupOverlappingPins(pins: readonly PlacedPin[], keepApartId: string | null = null): PinGroup[] {
  const ordered = [...pins].sort((a, b) => Number(b.bounty) - Number(a.bounty));
  const groups: PinGroup[] = [];
  // The selected pin always shows as itself, above the rest: it never joins or leads a cluster.
  const kept = ordered.find((p) => p.id === keepApartId);
  if (kept) groups.push({ lead: kept, members: [kept] });
  for (const pin of ordered) {
    if (pin === kept) continue;
    const home = groups.find((g) => g.lead !== kept && overlaps(g.lead, pin));
    if (home) home.members.push(pin);
    else groups.push({ lead: pin, members: [pin] });
  }
  return groups;
}
