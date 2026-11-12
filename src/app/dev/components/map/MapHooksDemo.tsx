"use client";
import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/Button";
import { MapListLayout } from "@/components/map/MapListLayout";
import { boundsAround, type Bounds, type MapJob } from "@/lib/map/pins";
import styles from "./preview.module.css";

export function MapHooksDemo({ jobs, serverNow }: { jobs: MapJob[]; serverNow: number }) {
  const [selectedId, setSelectedId] = useState<string | null>(null), [legendOpen, setLegendOpen] = useState(true), [lastSelection, setLastSelection] = useState("None"), [view, setView] = useState("");
  const legendToggle = useRef<HTMLSpanElement>(null);
  const reportView = useCallback((bounds: Bounds) => setView([bounds.west, bounds.south, bounds.east, bounds.north].map(value => value.toFixed(4)).join(", ")), []);
  const select = (id: string | null) => { setSelectedId(id); setLastSelection(id ?? "None"); };
  return <div className={styles.page} data-mode="trade"><header className={styles.band}><div className={styles.wrap}><h1 className={styles.title}>Map hooks</h1></div></header>
    <main className={styles.wrap}><section className={styles.section}><h2 className={styles.h2}>Controlled map</h2>
      <div className={styles.hookControls}><Button width="auto" variant="secondary" onClick={() => setSelectedId(jobs[0].id)}>Select first job</Button><Button width="auto" variant="secondary" onClick={() => setSelectedId(null)}>Clear selection</Button>
        <span ref={legendToggle}><Button width="auto" variant="secondary" onClick={() => setLegendOpen(previous => !previous)}>{legendOpen ? "Hide legend" : "Show legend"}</Button></span></div>
      <p>Selection events: <output aria-label="Selection events">{lastSelection}</output></p><p>View: <output aria-label="View bounds">{view}</output></p>
      <div className={styles.layoutFrame}><MapListLayout jobs={jobs} serverNow={serverNow} selectedId={selectedId} onSelect={select} onViewChange={reportView}
        bounds={boundsAround(jobs.map(job => job.point), 0.14) ?? undefined} jobHref={job => "/jobs/" + encodeURIComponent(job.id)}
        legend={{ open: legendOpen, onDismiss: () => { setLegendOpen(false); requestAnimationFrame(() => legendToggle.current?.querySelector<HTMLButtonElement>("button")?.focus()); } }} /></div>
    </section></main></div>;
}
