"use client";

import { useMemo, useState } from "react";
import { MapboxSurface, type MapboxViewport } from "@/components/map/MapboxSurface";
import { MapSurface } from "@/components/map/MapSurface";
import type { Coverage } from "@/lib/geo/coverage";
import styles from "./settings.module.css";

export function CoverageMap({ area, token }: { area: Coverage; token: string | null }) {
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<MapboxViewport | null>(null);
  const config = useMemo(() => ({ accessToken: token, workArea: area }), [token, area]);
  if (!token || failed) return <div><MapSurface label="Coverage area map" className={styles.map}><div className={styles.fallbackCircle}>{area.radiusKm} km</div></MapSurface><p className={styles.hint}>Map unavailable. Coverage uses the centre and radius shown above.</p></div>;
  const points = Array.from({ length: 73 }, (_, i) => {
    const angle = i / 72 * Math.PI * 2, angular = area.radiusKm / 6371.0088;
    const lat = area.centre.lat * Math.PI / 180, lng = area.centre.lng * Math.PI / 180;
    const y = Math.asin(Math.sin(lat) * Math.cos(angular) + Math.cos(lat) * Math.sin(angular) * Math.cos(angle));
    const x = lng + Math.atan2(Math.sin(angle) * Math.sin(angular) * Math.cos(lat), Math.cos(angular) - Math.sin(lat) * Math.sin(y));
    return view?.project({ lat: y * 180 / Math.PI, lng: x * 180 / Math.PI });
  }).filter((point): point is { x: number; y: number } => Boolean(point));
  return <div className={styles.map}><MapboxSurface config={config} label="Coverage area map" onViewChange={setView} onFailure={() => setFailed(true)}><svg className={styles.circleOverlay} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polygon points={points.map(point => `${point.x},${point.y}`).join(" ")} /></svg></MapboxSurface></div>;
}
