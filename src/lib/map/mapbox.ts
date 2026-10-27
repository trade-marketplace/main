import type { Coverage } from "@/lib/geo/coverage";
import type { Point } from "@/lib/geo/distance";
import type { Bounds } from "./pins";

/** Only a public, URL-restricted token may be sent to a browser. */
export type MapboxConfig = { accessToken: string | null; workArea: Coverage };
export type LngLat = [number, number];
export type MapboxBounds = [LngLat, LngLat];
export type MapboxMap = {
  on(event: string, listener: () => void): void;
  off(event: string, listener: () => void): void;
  fitBounds(bounds: MapboxBounds, options: { padding: number; duration: number; maxZoom: number }): void;
  flyTo(options: { center: LngLat; zoom: number; duration: number }): void;
  project(point: LngLat): { x: number; y: number };
  getBounds(): { getNorth(): number; getSouth(): number; getEast(): number; getWest(): number };
  getZoom(): number;
  zoomIn(): void;
  zoomOut(): void;
  resize(): void;
  remove(): void;
};
export type MapboxLibrary = {
  supported(): boolean;
  Map: new (options: {
    container: HTMLElement;
    accessToken: string;
    style: string;
    center: LngLat;
    zoom: number;
    attributionControl: boolean;
    dragRotate: boolean;
    pitchWithRotate: boolean;
    touchPitch: boolean;
  }) => MapboxMap;
};

export const MAPBOX_VERSION = "3.33.0";
export const MAPBOX_ASSET_ROOT = `https://api.mapbox.com/mapbox-gl-js/v${MAPBOX_VERSION}`;
export const lngLat = (point: Point): LngLat => [point.lng, point.lat];
export const mapboxBounds = (bounds: Bounds): MapboxBounds => [[bounds.west, bounds.south], [bounds.east, bounds.north]];

/** Camera bounds for the office's work area; includes the whole radius, including at NZ latitudes. */
export function workAreaBounds(area: Coverage): Bounds {
  const latSpan = area.radiusKm / 111.195;
  const lngSpan = latSpan / Math.max(0.01, Math.cos(area.centre.lat * Math.PI / 180));
  return {
    north: Math.min(85, area.centre.lat + latSpan), south: Math.max(-85, area.centre.lat - latSpan),
    east: Math.min(180, area.centre.lng + lngSpan), west: Math.max(-180, area.centre.lng - lngSpan),
  };
}

/** Asked on a button press only; no browser prompt just for opening the job board. */
export function requestCurrentLocation(geolocation: Pick<Geolocation, "getCurrentPosition"> | undefined = typeof navigator === "undefined" ? undefined : navigator.geolocation): Promise<Point> {
  return new Promise((resolve, reject) => {
    if (!geolocation) return reject(new Error("Location is unavailable"));
    geolocation.getCurrentPosition(
      ({ coords }) => resolve({ lat: coords.latitude, lng: coords.longitude }),
      () => reject(new Error("Location is unavailable")),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  });
}

let libraryPromise: Promise<MapboxLibrary> | undefined;

/** Load both pinned CDN assets once. A missing token never calls this or contacts Mapbox. */
export function loadMapbox(): Promise<MapboxLibrary> {
  if (libraryPromise) return libraryPromise;
  libraryPromise = new Promise<MapboxLibrary>((resolve, reject) => {
    const script = document.createElement("script");
    const css = document.createElement("link");
    let scriptReady = false;
    let cssReady = false;
    const timer = window.setTimeout(fail, 15_000);
    function fail() {
      window.clearTimeout(timer);
      script.remove(); css.remove();
      reject(new Error("Map could not load"));
    }
    function ready() {
      const lib = (window as Window & { mapboxgl?: MapboxLibrary }).mapboxgl;
      if (scriptReady && cssReady) {
        window.clearTimeout(timer);
        if (lib) resolve(lib); else fail();
      }
    }
    css.rel = "stylesheet";
    css.href = `${MAPBOX_ASSET_ROOT}/mapbox-gl.css`;
    css.onload = () => { cssReady = true; ready(); };
    css.onerror = fail;
    script.async = true;
    script.src = `${MAPBOX_ASSET_ROOT}/mapbox-gl.js`;
    script.onload = () => { scriptReady = true; ready(); };
    script.onerror = fail;
    document.head.append(css, script);
  }).catch((error) => { libraryPromise = undefined; throw error; });
  return libraryPromise;
}
