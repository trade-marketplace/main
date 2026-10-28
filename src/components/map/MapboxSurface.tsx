"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

import { Icon } from "@/components/Icon";
import type { Point } from "@/lib/geo/distance";
import {
  lngLat, loadMapbox, mapboxBounds, requestCurrentLocation, workAreaBounds,
  type MapboxConfig, type MapboxLibrary, type MapboxMap,
} from "@/lib/map/mapbox";
import type { Bounds } from "@/lib/map/pins";

import styles from "./map.module.css";

export type MapboxViewport = {
  bounds: Bounds;
  project: (point: Point) => { x: number; y: number } | null;
};

/** Injectable dependencies let offline previews and tests exercise the same provider lifecycle. */
export type MapboxServices = {
  load?: () => Promise<MapboxLibrary>;
  locate?: () => Promise<Point>;
};

type Props = {
  config: MapboxConfig;
  bounds?: Bounds;
  label: string;
  children: ReactNode;
  onViewChange: (view: MapboxViewport) => void;
  onFailure: () => void;
  services?: MapboxServices;
};

export function MapboxSurface({ config, bounds, label, children, onViewChange, onFailure, services }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapboxMap | null>(null);
  const callbacks = useRef({ onViewChange, onFailure });
  const [loaded, setLoaded] = useState(false);
  const [location, setLocation] = useState<"idle" | "pending" | "denied" | "found">("idle");
  const [you, setYou] = useState<Point | null>(null);
  const [youAt, setYouAt] = useState<{ x: number; y: number } | null>(null);
  const initialBounds = useRef(bounds);
  const fit = (instance: MapboxMap, area: Bounds) => instance.fitBounds(mapboxBounds(area), { padding: 64, maxZoom: 16, duration: 0 });

  useEffect(() => { callbacks.current = { onViewChange, onFailure }; }, [onViewChange, onFailure]);

  const { accessToken, workArea } = config;
  const loader = services?.load ?? loadMapbox;
  useEffect(() => {
    const element = container.current;
    if (!element || !accessToken) return;
    let disposed = false;
    let instance: MapboxMap | null = null;
    let observer: ResizeObserver | undefined;
    const timer = window.setTimeout(() => { if (!disposed) callbacks.current.onFailure(); }, 20_000);
    const publish = () => {
      if (!instance || disposed || element.clientWidth <= 1 || element.clientHeight <= 1) return;
      const b = instance.getBounds();
      const current = instance;
      callbacks.current.onViewChange({
        bounds: { north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest() },
        project(point) {
          const p = current.project(lngLat(point));
          return p.x >= 0 && p.y >= 0 && p.x <= element.clientWidth && p.y <= element.clientHeight
            ? { x: p.x / element.clientWidth * 100, y: p.y / element.clientHeight * 100 } : null;
        },
      });
    };
    const fail = () => { if (!disposed) { window.clearTimeout(timer); callbacks.current.onFailure(); } };
    void loader().then((lib) => {
      if (disposed) return;
      if (!lib.supported()) return fail();
      setLoaded(false); setYou(null); setYouAt(null); setLocation("idle");
      instance = new lib.Map({
        container: element, accessToken, style: "mapbox://styles/mapbox/streets-v12",
        center: lngLat(workArea.centre), zoom: 10, attributionControl: true,
        // Keep the flat map aligned with accessible HTML pins and their approximate-area circles.
        dragRotate: false, pitchWithRotate: false, touchPitch: false,
      });
      map.current = instance;
      instance.on("error", fail);
      instance.on("webglcontextlost", fail);
      instance.on("move", publish);
      instance.on("resize", publish);
      instance.on("load", () => {
        if (disposed || !instance) return;
        window.clearTimeout(timer);
        fit(instance, initialBounds.current ?? workAreaBounds(workArea));
        setLoaded(true);
        publish();
      });
      observer = new ResizeObserver(() => instance?.resize());
      observer.observe(element);
    }).catch(fail);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      observer?.disconnect();
      instance?.remove();
      map.current = null;
    };
  }, [accessToken, loader, workArea]);

  useEffect(() => { initialBounds.current = bounds; if (map.current && loaded && bounds) fit(map.current, bounds); }, [bounds, loaded]);
  useEffect(() => {
    const instance = map.current;
    const element = container.current;
    if (!instance || !you || !element) return;
    const update = () => {
      const point = instance.project(lngLat(you));
      setYouAt({ x: point.x / element.clientWidth * 100, y: point.y / element.clientHeight * 100 });
    };
    update(); instance.on("move", update); instance.on("resize", update);
    return () => { instance.off("move", update); instance.off("resize", update); };
  }, [you]);

  const locate = async () => {
    if (!map.current || !loaded) return;
    setLocation("pending");
    try {
      const point = await (services?.locate ?? requestCurrentLocation)();
      if (!map.current) return;
      setYou(point); setLocation("found");
      map.current.flyTo({ center: lngLat(point), zoom: Math.max(12, map.current.getZoom()), duration: 0 });
    } catch {
      if (!map.current) return;
      setYou(null); setYouAt(null); setLocation("denied");
      fit(map.current, workAreaBounds(workArea));
    }
  };

  return (
    <div role="region" aria-label={label} className={styles.surface}>
      <div ref={container} className={styles.mapboxCanvas} />
      <div className={`${styles.layer} ${styles.mapboxLayer}`}>
        {children}
        {youAt && <span className={styles.you} style={{ left: `${youAt.x}%`, top: `${youAt.y}%` }} role="img" aria-label="You are here" />}
      </div>
      {!loaded && <p role="status" className={styles.mapMessage}>Loading map…</p>}
      <div className={styles.providerControls}>
        <button type="button" onClick={() => map.current?.zoomIn()} disabled={!loaded} aria-label="Zoom in"><Icon name="add" decorative /></button>
        <button type="button" onClick={() => map.current?.zoomOut()} disabled={!loaded} aria-label="Zoom out"><Icon name="remove" decorative /></button>
        <button type="button" onClick={() => void locate()} disabled={!loaded || location === "pending"} aria-label="Use my location"><Icon name="my_location" decorative /></button>
      </div>
      {location === "pending" && <p role="status" className={styles.locationNotice}>Finding your location…</p>}
      {location === "denied" && <p role="status" className={styles.locationNotice}>Location unavailable.</p>}
      {location === "found" && <p role="status" className={styles.srOnly}>Map centred on your location.</p>}
    </div>
  );
}
