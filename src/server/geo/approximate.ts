import "server-only";

import { randomBytes } from "node:crypto";

import { EARTH_RADIUS_KM, type Point } from "@/lib/geo/distance";

// The approximate pin workers see before a job is claimed (#97): never the address itself.
//
// It's picked at random once, when the job's location is saved, and stored on the job (jobs.approx_lat/lng),
// so it stays put however often the map loads. It isn't derived from the job id or the address: anything
// derived could be worked backwards to the address by anyone who knows the formula. Stored, it can't.

/** The pin is at least this far from the real point, so it never sits on the house. */
export const APPROX_MIN_METRES = 100;
/** …and at most this far, so it is still on the right street or the next one. */
export const APPROX_MAX_METRES = 300;

/** A random number in [0, 1). Tests pass their own. */
export type Random = () => number;

/** Cryptographically random, so nobody can predict where the pin will land. */
export const secureRandom: Random = () => randomBytes(6).readUIntBE(0, 6) / 2 ** 48;

/**
 * A point 100–300 m from `exact`, in a random direction, spread evenly over that ring (so it isn't bunched
 * near the middle).
 */
export function approximatePin(exact: Point, random: Random = secureRandom): Point {
  const min = APPROX_MIN_METRES;
  const max = APPROX_MAX_METRES;
  // Even over the ring's area: the distance is the square root of a uniform pick between min² and max².
  const metres = Math.sqrt(min ** 2 + random() * (max ** 2 - min ** 2));
  const bearing = random() * 2 * Math.PI;
  return destination(exact, metres, bearing);
}

/** Where you end up going `metres` from `start` on `bearing` (radians clockwise from north), on a sphere. */
function destination(start: Point, metres: number, bearing: number): Point {
  const angular = metres / 1000 / EARTH_RADIUS_KM;
  const lat1 = (start.lat * Math.PI) / 180;
  const lng1 = (start.lng * Math.PI) / 180;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
    );
  // Back to degrees; longitude wrapped into -180..180 (matters only near the date line, not in NZ, but cheap).
  return { lat: (lat2 * 180) / Math.PI, lng: ((((lng2 * 180) / Math.PI + 540) % 360) - 180) };
}
