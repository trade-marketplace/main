import "server-only";

import type { CoverageCheck, LocationSource, PrismaClient } from "@/generated/prisma/client";
import { type Coverage, checkCoverage } from "@/lib/geo/coverage";
import { haversineKm, isInNewZealand, isPoint, type Point, roundKm } from "@/lib/geo/distance";

import { approximatePin, type Random, secureRandom } from "./approximate";

// Where a job is (#97): the coverage decision when it's posted, the office's check, the approximate pin and
// how far it is from a worker. Posting a job (C04) calls resolveJobLocation() and, when it's ok, saves the
// result with the job (or with saveJobLocation()).

/** What the customer gave us. `suburb` is what they typed or picked, for the waitlist page. */
export type LocationInput =
  // Picked from address search.
  | { source: "SEARCH"; suburb: string; point: Point }
  // Address not found (new subdivision, rural): typed by hand and a pin dropped on the map.
  | { source: "PIN"; suburb: string; point: Point }
  // Address search was down (or isn't set up): typed by hand, no point.
  | { source: "TYPED"; suburb: string };

/** The location columns on `jobs`. */
export type JobLocation = {
  lat: number | null;
  lng: number | null;
  approxLat: number | null;
  approxLng: number | null;
  locationSource: LocationSource;
  coverage: CoverageCheck;
  locationNeedsCheck: boolean;
};

export type ResolvedLocation =
  | { ok: true; location: JobLocation }
  // Not posted: send them to the waitlist page (A07) with their suburb filled in.
  | { ok: false; error: "outside-coverage"; waitlist: { path: string; suburb: string; areaName: string } }
  // A point that isn't in New Zealand (or isn't a point): ask them to search or drop the pin again.
  | { ok: false; error: "invalid-point" };

/**
 * Decides what to store for a job's location, or why it can't be posted.
 *
 * - Search result inside the area: posted, nothing for the office to do.
 * - Dropped pin inside the area: posted, flagged for the office to check the address matches the pin.
 * - Typed with no point (search down): posted, coverage "check later", flagged for the office.
 * - Anything with a point outside the area: not posted, waitlist instead.
 *
 * The point comes from the browser (the picked suggestion, or the pin), so it's only trusted as far as the
 * customer's own job goes; a pin also gets the office's eye.
 */
export function resolveJobLocation(
  input: LocationInput,
  coverage: Coverage,
  random: Random = secureRandom,
): ResolvedLocation {
  if (input.source === "TYPED") {
    return {
      ok: true,
      location: {
        lat: null,
        lng: null,
        approxLat: null,
        approxLng: null,
        locationSource: "TYPED",
        coverage: "CHECK_LATER",
        locationNeedsCheck: true,
      },
    };
  }

  if (!isPoint(input.point) || !isInNewZealand(input.point)) return { ok: false, error: "invalid-point" };

  const check = checkCoverage(coverage, input.point);
  if (check.status === "outside") {
    return {
      ok: false,
      error: "outside-coverage",
      waitlist: { path: check.waitlistPath, suburb: input.suburb.trim(), areaName: coverage.name },
    };
  }

  const approx = approximatePin(input.point, random);
  return {
    ok: true,
    location: {
      lat: input.point.lat,
      lng: input.point.lng,
      approxLat: approx.lat,
      approxLng: approx.lng,
      locationSource: input.source,
      coverage: "INSIDE",
      locationNeedsCheck: input.source === "PIN",
    },
  };
}

/** The location columns for a saved address (C21). Coverage isn't stored: it's checked when a job is posted. */
export function addressLocation(input: LocationInput): {
  lat: number | null;
  lng: number | null;
  locationSource: LocationSource;
} {
  return input.source === "TYPED"
    ? { lat: null, lng: null, locationSource: "TYPED" }
    : { lat: input.point.lat, lng: input.point.lng, locationSource: input.source };
}

type Db = Pick<PrismaClient, "job">;

/** Writes a job's location: the point and its approximate pin always together. */
export async function saveJobLocation(db: Db, jobId: string, location: JobLocation): Promise<void> {
  await db.job.update({ where: { id: jobId }, data: location });
}

/** Office queue: jobs whose location needs checking (a dropped pin, or typed while search was down), oldest first. */
export function listJobsNeedingLocationCheck(db: Db, take = 50) {
  return db.job.findMany({
    where: { locationNeedsCheck: true },
    orderBy: { createdAt: "asc" },
    take,
    select: {
      id: true,
      jobNumber: true,
      addressLine1: true,
      suburb: true,
      city: true,
      lat: true,
      lng: true,
      locationSource: true,
      coverage: true,
      createdAt: true,
    },
  });
}

/**
 * How far a job is from a worker, in whole km. The worker who claimed it gets the distance to the real
 * address; everyone else gets it to the approximate pin, so repeated looks from different places can't
 * narrow down the address. Null when there's nothing to measure to (no point yet).
 */
export function distanceToJobKm(from: Point, job: JobPoints, viewerId: string): number | null {
  const to = jobPinFor(job, viewerId);
  return to ? roundKm(haversineKm(from, to)) : null;
}

type JobPoints = {
  lat: number | null;
  lng: number | null;
  approxLat: number | null;
  approxLng: number | null;
  workerId: string | null;
};

/** Where a job goes on a worker's map: the approximate pin until they've claimed it. Never the address before. */
export function jobPinFor(job: JobPoints, viewerId: string): Point | null {
  return job.workerId !== null && job.workerId === viewerId
    ? pointOf(job.lat, job.lng)
    : pointOf(job.approxLat, job.approxLng);
}

function pointOf(lat: number | null, lng: number | null): Point | null {
  return lat === null || lng === null ? null : { lat, lng };
}
