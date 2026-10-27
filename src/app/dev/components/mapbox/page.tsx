import type { Metadata } from "next";
import Link from "next/link";

import { INVERCARGILL_COVERAGE } from "@/lib/geo/coverage";
import { guardDevPage } from "@/server/dev-pages";
import { publicMapboxToken } from "@/server/geo/mapbox-config";

import { demoJobs } from "../map/demo-jobs";
import { MapboxPreview, type PreviewState } from "./MapboxPreview";
import styles from "./preview.module.css";

export const metadata: Metadata = { title: "Mapbox provider (dev)", robots: { index: false, follow: false } };
const states: PreviewState[] = ["ready", "missing-token", "loading", "error", "empty", "location-denied", "live"];
const names: Record<PreviewState, string> = { ready: "Jobs", "missing-token": "No token", loading: "Loading", error: "Map failure", empty: "No jobs", "location-denied": "Location denied", live: "Live Mapbox" };
const renderTime = () => Date.now();

export default async function MapboxPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  guardDevPage();
  const params = await searchParams;
  const state: PreviewState = states.includes(params.state as PreviewState) ? params.state as PreviewState : "ready";
  const now = renderTime();
  const token = state === "live" ? publicMapboxToken() : state === "missing-token" ? null : "pk.offline-fixture";
  return <div className={styles.page} data-mode="trade">
    <header className={styles.header}>
      <p>Dev only · D03 / D18</p>
      <h1>Mapbox provider</h1>
      <p>Offline fixture: illustrated tiles, real provider lifecycle, pins, clustering and camera controls. “Live Mapbox” uses MAPBOX_ACCESS_TOKEN, or falls back to the list.</p>
      <nav aria-label="Provider state">{states.map((s) => <Link key={s} href={`/dev/components/mapbox?state=${s}`} aria-current={s === state ? "page" : undefined}>{names[s]}</Link>)}</nav>
    </header>
    <main><MapboxPreview jobs={demoJobs(now)} now={now} state={state} config={{ accessToken: token, workArea: INVERCARGILL_COVERAGE }} /></main>
  </div>;
}
