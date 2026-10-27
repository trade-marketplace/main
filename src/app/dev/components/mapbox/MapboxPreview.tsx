"use client";

import { useEffect, useMemo, useRef } from "react";

import { MapListLayout } from "@/components/map/MapListLayout";
import type { MapboxServices } from "@/components/map/MapboxSurface";
import type { MapboxConfig, MapboxLibrary, MapboxMap, MapboxBounds, LngLat } from "@/lib/map/mapbox";
import { boundsAround, projectPoint, type Bounds, type MapJob } from "@/lib/map/pins";

import styles from "./preview.module.css";

export type PreviewState = "ready" | "missing-token" | "loading" | "error" | "empty" | "location-denied" | "live";

/** Deterministic, offline camera adapter. No token, tiles, permission prompts or real customer data are used. */
function fixtureLibrary(loading: boolean): MapboxLibrary {
  return {
    supported: () => true,
    Map: class implements MapboxMap {
      private listeners = new Map<string, Set<() => void>>();
      private bounds: Bounds = { north: -46.35, south: -46.46, east: 168.45, west: 168.29 };
      private zoom = 10;
      private element: HTMLElement;
      private disposed = false;
      constructor({ container }: { container: HTMLElement }) {
        this.element = container;
        container.classList.add(styles.fixtureMap);
        if (!loading) window.setTimeout(() => this.emit("load"), 20);
      }
      on(event: string, listener: () => void) { const set = this.listeners.get(event) ?? new Set(); set.add(listener); this.listeners.set(event, set); }
      off(event: string, listener: () => void) { this.listeners.get(event)?.delete(listener); }
      private emit(event: string) { if (!this.disposed) this.listeners.get(event)?.forEach((listener) => listener()); }
      fitBounds([[west, south], [east, north]]: MapboxBounds) {
        this.bounds = { north, south, east, west }; this.element.dataset.cameraBounds = JSON.stringify(this.bounds); this.emit("move");
      }
      flyTo({ center: [lng, lat], zoom }: { center: LngLat; zoom: number }) {
        this.zoom = zoom;
        this.bounds = boundsAround([{ lat, lng }], .5, 360 / 2 ** zoom)!;
        this.emit("move");
      }
      project([lng, lat]: LngLat) {
        const point = projectPoint({ lat, lng }, this.bounds);
        return point ? { x: point.x / 100 * this.element.clientWidth, y: point.y / 100 * this.element.clientHeight } : { x: -1, y: -1 };
      }
      getBounds() { return { getNorth: () => this.bounds.north, getSouth: () => this.bounds.south, getEast: () => this.bounds.east, getWest: () => this.bounds.west }; }
      getZoom() { return this.zoom; }
      zoomIn() { this.scale(.5); }
      zoomOut() { this.scale(2); }
      private scale(factor: number) {
        const b = this.bounds, lat = (b.north + b.south) / 2, lng = (b.east + b.west) / 2;
        const height = (b.north - b.south) * factor / 2, width = (b.east - b.west) * factor / 2;
        this.bounds = { north: lat + height, south: lat - height, east: lng + width, west: lng - width };
        this.emit("move");
      }
      resize() { this.emit("resize"); }
      remove() { this.disposed = true; this.listeners.clear(); }
    },
  };
}

export function MapboxPreview({ jobs, now, state, config }: { jobs: MapJob[]; now: number; state: PreviewState; config: MapboxConfig }) {
  const wrapper = useRef<HTMLDivElement>(null);
  const services = useMemo<MapboxServices | undefined>(() => state === "live" ? undefined : {
    load: () => state === "error" ? Promise.reject(new Error("Offline test")) : Promise.resolve(fixtureLibrary(state === "loading")),
    locate: () => state === "location-denied" ? Promise.reject(new Error("Permission denied")) : Promise.resolve(config.workArea.centre),
  }, [state, config.workArea.centre]);
  // Make the denied state reviewable in a screenshot; the real component only asks on the user's button press.
  useEffect(() => {
    if (state !== "location-denied" || !wrapper.current) return;
    const element = wrapper.current;
    const clickWhenReady = () => {
      const button = element.querySelector<HTMLButtonElement>('button[aria-label="Use my location"]');
      if (button && !button.disabled) { observer.disconnect(); button.click(); }
    };
    const observer = new MutationObserver(clickWhenReady);
    observer.observe(element, { subtree: true, attributes: true, attributeFilter: ["disabled"] });
    clickWhenReady();
    return () => observer.disconnect();
  }, [state]);
  return <div ref={wrapper}><MapListLayout jobs={state === "empty" ? [] : jobs} serverNow={now} mapbox={config} mapboxServices={services} approxRadiusMetres={300} /></div>;
}
