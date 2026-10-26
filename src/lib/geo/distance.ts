// Distances between two points on the map (#97). Pure: safe on the server and in the browser.

export type Point = { lat: number; lng: number };

// Mean Earth radius (IUGG), in km. Haversine on a sphere is within 0.5% of the true distance, plenty for
// "how far is this job".
export const EARTH_RADIUS_KM = 6371.0088;

/** Straight-line ("as the crow flies") distance in km, by the haversine formula. */
export function haversineKm(a: Point, b: Point): number {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  // min() guards against rounding pushing h a hair over 1 for points on opposite sides of the Earth.
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Whole km, half up (2.5 → 3). Under 0.5 km is 0; show it with formatKm, which says "<1 km". */
export function roundKm(km: number): number {
  if (!Number.isFinite(km) || km < 0) throw new RangeError(`not a distance: ${km}`);
  return Math.round(km);
}

/** How a distance is shown: "12 km", or "<1 km" when it rounds to nothing. */
export function formatKm(km: number): string {
  const rounded = roundKm(km);
  return rounded === 0 ? "<1 km" : `${rounded} km`;
}

/** Roughly New Zealand's main islands and Stewart Island, to reject a pin dropped somewhere else. */
export function isInNewZealand(point: Point): boolean {
  return point.lat >= -47.5 && point.lat <= -34 && point.lng >= 166 && point.lng <= 178.8;
}

export function isPoint(value: Point): boolean {
  return (
    Number.isFinite(value.lat) &&
    Number.isFinite(value.lng) &&
    value.lat >= -90 &&
    value.lat <= 90 &&
    value.lng >= -180 &&
    value.lng <= 180
  );
}
