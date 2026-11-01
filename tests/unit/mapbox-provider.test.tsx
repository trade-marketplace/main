import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import MapboxPage from "@/app/dev/components/mapbox/page";
import { MapListLayout } from "@/components/map/MapListLayout";
import { INVERCARGILL_COVERAGE } from "@/lib/geo/coverage";
import { haversineKm } from "@/lib/geo/distance";
import { lngLat, mapboxBounds, requestCurrentLocation, workAreaBounds } from "@/lib/map/mapbox";
import type { MapJob } from "@/lib/map/pins";
import { loadMapboxConfig, publicMapboxToken } from "@/server/geo/mapbox-config";

const job: MapJob = { id: "j", title: "Local work", suburb: "Windsor", point: { lat: -46.4, lng: 168.3 }, precision: "approximate", kind: "claim", earnCents: 10000 };
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("server map configuration", () => {
  it("reads MAPBOX_ACCESS_TOKEN, exposes public tokens only, and fails closed for secrets or malformed values", () => {
    for (const raw of [undefined, "", "  ", "sk.secret", "not-a-token", "pk.<script>"]) expect(publicMapboxToken(raw)).toBeNull();
    expect(publicMapboxToken(" pk.demo-token ")).toBe("pk.demo-token");
    vi.stubEnv("MAPBOX_ACCESS_TOKEN", "pk.from-environment");
    expect(publicMapboxToken()).toBe("pk.from-environment");
  });
  it("loads the office work area instead of fixing the component to Invercargill", async () => {
    vi.stubEnv("MAPBOX_ACCESS_TOKEN", "pk.demo");
    const source = vi.fn(async () => ({ name: "New area", lat: -45, lng: 170, radiusKm: 25 }));
    expect(await loadMapboxConfig(source)).toEqual({ accessToken: "pk.demo", workArea: { name: "New area", centre: { lat: -45, lng: 170 }, radiusKm: 25 } });
    expect(source).toHaveBeenCalledOnce();
  });
});

describe("camera and location", () => {
  it("uses Mapbox's longitude, latitude order", () => {
    expect(lngLat({ lat: -46, lng: 168 })).toEqual([168, -46]);
    expect(mapboxBounds({ north: -45, south: -47, east: 170, west: 166 })).toEqual([[166, -47], [170, -45]]);
  });
  it("fits the complete configured work radius when permission is denied or jobs are empty", () => {
    const b = workAreaBounds(INVERCARGILL_COVERAGE);
    for (const point of [{ lat: b.north, lng: INVERCARGILL_COVERAGE.centre.lng }, { lat: INVERCARGILL_COVERAGE.centre.lat, lng: b.east }]) {
      expect(haversineKm(INVERCARGILL_COVERAGE.centre, point)).toBeCloseTo(60, 1);
    }
  });
  it("returns a permitted location and bounds the browser's request time", async () => {
    const getCurrentPosition = vi.fn((success: PositionCallback, _error?: PositionErrorCallback | null, options?: PositionOptions) => {
      expect(options).toMatchObject({ timeout: 10000, enableHighAccuracy: false });
      success({ coords: { latitude: -46, longitude: 168 } } as GeolocationPosition);
    });
    await expect(requestCurrentLocation({ getCurrentPosition })).resolves.toEqual({ lat: -46, lng: 168 });
  });
  it("handles permission denied, timeouts and unsupported browsers without an uncaught error", async () => {
    for (const code of [1, 2, 3]) {
      const getCurrentPosition = vi.fn((_success: PositionCallback, error?: PositionErrorCallback | null) => error?.({ code } as GeolocationPositionError));
      await expect(requestCurrentLocation({ getCurrentPosition })).rejects.toThrow("Location is unavailable");
    }
    vi.stubGlobal("navigator", {});
    await expect(requestCurrentLocation()).rejects.toThrow("Location is unavailable");
  });
});

describe("pinned CDN loader", () => {
  it("waits for both SDK and CSS, shares concurrent loads, and returns the Mapbox API", async () => {
    vi.resetModules();
    const elements: Record<string, unknown>[] = [];
    const lib = { supported: () => true, Map: class {} };
    vi.stubGlobal("window", { setTimeout, clearTimeout, mapboxgl: lib });
    vi.stubGlobal("document", { createElement: () => ({ remove: vi.fn() }), head: { append: (...args: Record<string, unknown>[]) => elements.push(...args) } });
    const { loadMapbox, MAPBOX_ASSET_ROOT } = await import("@/lib/map/mapbox");
    const first = loadMapbox();
    expect(loadMapbox()).toBe(first);
    expect(elements).toHaveLength(2);
    const [css, script] = elements;
    expect(css.href).toBe(`${MAPBOX_ASSET_ROOT}/mapbox-gl.css`);
    expect(script.src).toBe(`${MAPBOX_ASSET_ROOT}/mapbox-gl.js`);
    (script.onload as () => void)();
    (css.onload as () => void)();
    await expect(first).resolves.toBe(lib);
  });
  it("cleans failed assets and allows another load after a failure or timeout", async () => {
    vi.resetModules(); vi.useFakeTimers();
    const elements: { remove: ReturnType<typeof vi.fn>; onerror?: () => void }[] = [];
    vi.stubGlobal("window", { setTimeout, clearTimeout });
    vi.stubGlobal("document", { createElement: () => ({ remove: vi.fn() }), head: { append: (...args: typeof elements) => elements.push(...args) } });
    const { loadMapbox } = await import("@/lib/map/mapbox");
    const first = loadMapbox();
    const failed = expect(first).rejects.toThrow("Map could not load");
    elements[0].onerror!();
    await failed;
    expect(elements[0].remove).toHaveBeenCalledOnce();
    expect(elements[1].remove).toHaveBeenCalledOnce();
    const second = loadMapbox();
    expect(second).not.toBe(first);
    const timeout = expect(second).rejects.toThrow("Map could not load");
    await vi.advanceTimersByTimeAsync(15000);
    await timeout;
  });
});

describe("list fallback and preview states", () => {
  it("renders every job and its accessible row without a token or a network request", () => {
    const load = vi.fn();
    const html = renderToString(<MapListLayout jobs={[job]} serverNow={0} mapbox={{ accessToken: null, workArea: INVERCARGILL_COVERAGE }} mapboxServices={{ load }} />);
    expect(html).toContain("Map unavailable. Showing jobs in a list.");
    expect(html).toContain("1 job nearby");
    expect(html).toContain("Ready to claim: Local work, Windsor, earn $100.00");
    expect(html).not.toContain("Map of");
    expect(load).not.toHaveBeenCalled();
  });
  it("keeps loading, empty and data-error states accessible when the provider is absent", () => {
    for (const [state, message] of [["loading", "Loading jobs"], ["empty", "No jobs in view"], ["error", "Couldn’t load jobs"]] as const) {
      const html = renderToString(<MapListLayout jobs={[]} state={state} serverNow={0} mapbox={{ accessToken: null, workArea: INVERCARGILL_COVERAGE }} />);
      expect(html).toContain(message);
    }
  });
  it("guards the provider preview in production and exposes every reviewer state in development", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(MapboxPage({ searchParams: Promise.resolve({}) })).rejects.toMatchObject({ digest: expect.stringContaining("404") });
    vi.stubEnv("NODE_ENV", "development");
    const html = renderToString(await MapboxPage({ searchParams: Promise.resolve({ state: "missing-token" }) }));
    for (const state of ["ready", "missing-token", "loading", "error", "empty", "location-denied", "live"]) expect(html).toContain(`state=${state}`);
    expect(html).toContain("Map unavailable");
  });
});
