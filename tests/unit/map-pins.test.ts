import { describe, expect, it } from "vitest";

import {
  bountyRemainingMs,
  boundsAround,
  clusterName,
  clusterText,
  estimatePinWidth,
  formatPinDollars,
  formatTimeLeftSpoken,
  groupOverlappingPins,
  isExpired,
  jobCaption,
  jobOffer,
  keepInside,
  type MapJob,
  metresAsWidthPct,
  PIN_HEIGHT_PX,
  pinName,
  pinText,
  type PlacedPin,
  projectPoint,
} from "@/lib/map/pins";

const HOUR = 3_600_000;
const MIN = 60_000;
const base = { title: "Hot water cylinder", suburb: "Gladstone", trade: "Plumbing", distanceKm: 6, point: { lat: -46.39, lng: 168.35 }, precision: "approximate" as const };
const bounty: MapJob = { ...base, id: "b", kind: "bounty", bountyCents: 3000, endsAt: 10 * HOUR, durationMs: 24 * HOUR };
const claim: MapJob = { ...base, id: "c", kind: "claim", earnCents: 25920, title: "Sub wiring", suburb: "Windsor" };
const estimate: MapJob = { ...base, id: "e", kind: "estimate" };
const visit: MapJob = { ...base, id: "v", kind: "visit" };

describe("bounty countdown", () => {
  it("counts down to the end time and stops at 0", () => {
    expect(bountyRemainingMs(10 * HOUR, 7 * HOUR)).toBe(3 * HOUR);
    expect(bountyRemainingMs(10 * HOUR, 10 * HOUR)).toBe(0);
    expect(bountyRemainingMs(10 * HOUR, 11 * HOUR)).toBe(0);
  });

  it("is expired at 0 and after, not a moment before", () => {
    expect(isExpired(0)).toBe(true);
    expect(isExpired(-5)).toBe(true);
    expect(isExpired(1)).toBe(false);
  });

  it("reads time left in whole hours from 1h, minutes under an hour", () => {
    expect(formatTimeLeftSpoken(3 * HOUR + 20 * MIN)).toBe("3 h left");
    expect(formatTimeLeftSpoken(17 * HOUR + 59 * MIN)).toBe("17 h left");
    expect(formatTimeLeftSpoken(HOUR)).toBe("1 h left");
    expect(formatTimeLeftSpoken(59 * MIN + 1)).toBe("1 h left"); // 59m and a bit rounds up to 60 minutes
    expect(formatTimeLeftSpoken(42 * MIN)).toBe("42 min left");
    expect(formatTimeLeftSpoken(30_000)).toBe("1 min left");
    expect(formatTimeLeftSpoken(0)).toBe("expired");
  });

  it("only changes the spoken name once an hour above 1h, so it never chatters", () => {
    const names = new Set<string>();
    for (let ms = 3 * HOUR; ms < 4 * HOUR - MIN; ms += MIN) names.add(formatTimeLeftSpoken(ms));
    expect([...names]).toEqual(["3 h left"]);
  });
});

describe("pin text", () => {
  it("shows what the tradie earns in whole dollars on a claim pin", () => {
    expect(pinText(claim, null)).toBe("$259");
    expect(formatPinDollars(9650)).toBe("$97");
  });

  it("labels estimate and visit pins", () => {
    expect(pinText(estimate, null)).toBe("Estimate");
    expect(pinText(visit, null)).toBe("Visit");
  });

  it("shows a bounty's amount and the time left, and Expired once it's over", () => {
    expect(pinText(bounty, 17 * HOUR + 42 * MIN)).toBe("$30 · 17h");
    expect(pinText(bounty, 3 * HOUR + 20 * MIN)).toBe("$30 · 3h 20m");
    expect(pinText(bounty, 42 * MIN)).toBe("$30 · 42m");
    expect(pinText(bounty, 0)).toBe("$30 · Expired");
  });

  it("before the clock is known, shows the bounty's full time", () => {
    expect(pinText(bounty, null)).toBe("$30 · 24h");
  });
});

describe("pin names (what a screen reader hears)", () => {
  it("names a bounty by kind, title, suburb and time left", () => {
    expect(pinName(bounty, 3 * HOUR + 5 * MIN)).toBe("Bounty: Hot water cylinder, Gladstone, 3 h left");
    expect(pinName(bounty, 0)).toBe("Bounty: Hot water cylinder, Gladstone, expired");
  });

  it("names a claim pin with what the tradie earns, in full", () => {
    expect(pinName(claim, null)).toBe("Ready to claim: Sub wiring, Windsor, earn $259.20");
  });

  it("names estimate and visit pins", () => {
    expect(pinName(estimate, null)).toBe("Needs an estimate: Hot water cylinder, Gladstone");
    expect(pinName(visit, null)).toBe("Needs a site visit: Hot water cylinder, Gladstone");
  });

  it("keeps a very long title and suburb whole in the name (only the visible row is cut)", () => {
    const long = { ...estimate, title: "Replace all the guttering ".repeat(5).trim(), suburb: "Invercargill Central Business District" };
    expect(pinName(long, null)).toBe(`Needs an estimate: ${long.title}, Invercargill Central Business District`);
  });
});

describe("captions and offers", () => {
  it("joins distance, suburb and trade, skipping what's unknown", () => {
    expect(jobCaption(bounty)).toBe("6 km · Gladstone · Plumbing");
    expect(jobCaption({ suburb: "Kew", distanceKm: null })).toBe("Kew");
    expect(jobCaption({ suburb: "Kew", distanceKm: 0.2, trade: "Other" })).toBe("<1 km · Kew · Other");
  });

  it("says what the tradie gets for each kind", () => {
    expect(jobOffer(claim, null)).toBe("Earn $259.20");
    expect(jobOffer(estimate, null)).toBe("Quote from photos");
    expect(jobOffer(visit, null)).toBe("Quote in person");
    expect(jobOffer(bounty, 17 * HOUR)).toBe("Bounty $30.00 · 17h left");
    expect(jobOffer(bounty, 0)).toBe("Bounty $30.00 · expired");
  });
});

describe("clusters", () => {
  it("names a cluster and says how many bounties are in it", () => {
    expect(clusterName(8)).toBe("8 jobs here. Zoom in to see them");
    expect(clusterName(8, 2)).toBe("8 jobs here, 2 of them bounties. Zoom in to see them");
    expect(clusterName(2, 1)).toBe("2 jobs here, 1 of them a bounty. Zoom in to see them");
    expect(clusterName(3, 3)).toBe("3 jobs here, all of them bounties. Zoom in to see them");
  });

  it("caps the visible count at 99+", () => {
    expect(clusterText(7)).toBe("7");
    expect(clusterText(99)).toBe("99");
    expect(clusterText(128)).toBe("99+");
  });

  const pin = (id: string, x: number, y: number, bounty = false): PlacedPin => ({ id, x, y, width: 60, bounty });

  it("keeps pins that don't overlap apart", () => {
    const groups = groupOverlappingPins([pin("a", 0, 0), pin("b", 200, 0), pin("c", 0, 200)]);
    expect(groups.map((g) => g.members.length)).toEqual([1, 1, 1]);
  });

  it("merges pins that would overlap, led by a bounty so gold is never hidden", () => {
    const groups = groupOverlappingPins([pin("a", 100, 100), pin("b", 120, 110, true), pin("far", 400, 400)]);
    expect(groups).toHaveLength(2);
    expect(groups[0].lead.id).toBe("b");
    expect(groups[0].members.map((m) => m.id).sort()).toEqual(["a", "b"]);
  });

  it("treats pins side by side as overlapping only when their labels would touch", () => {
    expect(groupOverlappingPins([pin("a", 0, 0), pin("b", 64, 0)])).toHaveLength(2);
    expect(groupOverlappingPins([pin("a", 0, 0), pin("b", 63, 0)])).toHaveLength(1);
    expect(groupOverlappingPins([pin("a", 0, 0), pin("b", 0, PIN_HEIGHT_PX + 4)])).toHaveLength(2);
  });

  it("never hides the selected pin in a cluster", () => {
    const groups = groupOverlappingPins([pin("a", 100, 100, true), pin("sel", 110, 100), pin("c", 115, 105)], "sel");
    const sel = groups.find((g) => g.lead.id === "sel")!;
    expect(sel.members).toHaveLength(1);
    expect(groups.find((g) => g.lead.id === "a")!.members.map((m) => m.id).sort()).toEqual(["a", "c"]);
  });

  it("estimates wider pins for longer text and an icon", () => {
    expect(estimatePinWidth("$30 · 17h", true)).toBeGreaterThan(estimatePinWidth("$259", false));
  });
});

describe("placing pins on the map", () => {
  const bounds = { north: -46.38, south: -46.44, west: 168.33, east: 168.41 };

  it("puts the corners and the middle where expected", () => {
    expect(projectPoint({ lat: -46.38, lng: 168.33 }, bounds)).toEqual({ x: 0, y: 0 });
    const se = projectPoint({ lat: -46.44, lng: 168.41 }, bounds)!;
    expect(se.x).toBeCloseTo(100);
    expect(se.y).toBeCloseTo(100);
    const mid = projectPoint({ lat: -46.41, lng: 168.37 }, bounds)!;
    expect(mid.x).toBeCloseTo(50);
    expect(mid.y).toBeGreaterThan(49);
    expect(mid.y).toBeLessThan(51);
  });

  it("leaves out points outside the map", () => {
    expect(projectPoint({ lat: -46.0, lng: 168.37 }, bounds)).toBeNull();
    expect(projectPoint({ lat: -46.41, lng: 170 }, bounds)).toBeNull();
  });

  it("fits bounds around points with padding, and a minimum size for one point", () => {
    expect(boundsAround([])).toBeNull();
    const b = boundsAround([{ lat: -46.4, lng: 168.3 }, { lat: -46.42, lng: 168.4 }], 0.1)!;
    expect(b.north).toBeCloseTo(-46.398);
    expect(b.west).toBeCloseTo(168.29);
    const one = boundsAround([{ lat: -46.4, lng: 168.3 }], 0)!;
    expect(one.north - one.south).toBeCloseTo(0.01);
  });

  it("measures a distance as a share of the map's width", () => {
    const pct = metresAsWidthPct(600, bounds);
    // 0.08° of longitude at -46.41° is about 6.1 km, so 600 m is about 10%.
    expect(pct).toBeGreaterThan(9);
    expect(pct).toBeLessThan(11);
  });

  it("keeps a pin's label inside the map edge", () => {
    const p = { id: "a", x: 2, y: 3, width: 80, bounty: false };
    expect(keepInside(p, 400, 300)).toEqual({ x: 44, y: PIN_HEIGHT_PX + 10 });
    expect(keepInside({ ...p, x: 399, y: 299 }, 400, 300)).toEqual({ x: 356, y: 296 });
    expect(keepInside({ ...p, x: 200, y: 150 }, 400, 300)).toEqual({ x: 200, y: 150 });
  });
});
