// /dev/components/map: every map pin variant and state, the map card and the map + list layout (#82), for checking
// against D03 / D18 in docs/design/pages.html. Development only: in a production build this page is a 404.
// The map is a placeholder surface until Mapbox is wired in (separate issue): no token, no network.
import type { Metadata } from "next";
import Link from "next/link";

import { BoltMark } from "@/components/BoltMark";
import { MapCard } from "@/components/map/MapCard";
import { type MapListState, MapListLayout } from "@/components/map/MapListLayout";
import { ApproxArea, ClusterPin, MapPin } from "@/components/map/MapPin";
import { MapLegend, MapSurface } from "@/components/map/MapSurface";
import { boundsAround, type MapJob, metresAsWidthPct, projectPoint } from "@/lib/map/pins";
import { isMode, MODES, type Mode } from "@/lib/mode";
import { APPROX_MAX_METRES, APPROX_MIN_METRES } from "@/server/geo/approximate";
import { guardDevPage } from "@/server/dev-pages";

import { DEMO_YOU, demoClaimPair, demoJobs, type DemoJob } from "./demo-jobs";
import styles from "./preview.module.css";

export const metadata: Metadata = {
  title: "Map pins (dev)",
  robots: { index: false, follow: false },
};

const MODE_NAMES: Record<Mode, string> = { customer: "Customer", trade: "Trade", office: "Office" };
/** The map is a tradie screen, so this page opens in trade mode. */
const PAGE_DEFAULT_MODE: Mode = "trade";
const STATES: { id: MapListState; name: string }[] = [
  { id: "ready", name: "Jobs" },
  { id: "loading", name: "Loading" },
  { id: "empty", name: "Nothing in view" },
  { id: "error", name: "Error" },
];
const isState = (value: unknown): value is MapListState => STATES.some((s) => s.id === value);

/** When the page is rendered: bounties count down from here (the browser's clock takes over after hydration). */
const renderTime = () => Date.now();

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function MapComponentsPage({ searchParams }: { searchParams: SearchParams }) {
  guardDevPage();

  const params = await searchParams;
  const mode: Mode = isMode(params.mode) ? params.mode : PAGE_DEFAULT_MODE;
  const state: MapListState = isState(params.state) ? params.state : "ready";
  const now = renderTime();
  const jobs = demoJobs(now);
  const find = (id: string) => jobs.find((j) => j.id === id)!;

  const href = (next: { mode?: Mode; state?: MapListState }) => {
    const q = new URLSearchParams();
    const m = next.mode ?? mode;
    const s = next.state ?? state;
    if (m !== PAGE_DEFAULT_MODE) q.set("mode", m);
    if (s !== "ready") q.set("state", s);
    const query = q.toString();
    return query ? `/dev/components/map?${query}` : "/dev/components/map";
  };

  const bounty = find("TM-1009");
  const urgent = find("TM-1013");
  const expired = find("TM-1017");
  const longJob = find("TM-1014");

  return (
    <div className={styles.page} data-mode={mode}>
      <header className={styles.band}>
        <BoltMark variant="hero" className={styles.bandBolt} />
        <div className={styles.wrap}>
          <p className={styles.eyebrow}>Dev only · not in production builds</p>
          <h1 className={styles.title}>Map pins</h1>
          <p className={styles.lede}>
            Pins, clusters, the map card and the map + list layout from <code>src/components/map</code>. The map is a
            placeholder until Mapbox is wired in. Every pin for a job you haven’t claimed is its approximate pin (#97).
            Turn on “Reduce motion” to stop the bounty shimmer and make the hover growth instant.
          </p>
          <nav aria-label="Mode" className={styles.nav}>
            {MODES.map((m) => (
              <Link key={m} href={href({ mode: m })} aria-current={m === mode ? "page" : undefined} className={styles.navLink}>
                {MODE_NAMES[m]}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main className={styles.wrap}>
        <nav aria-label="Sections" className={styles.toc}>
          <a href="#pins">Pins</a>
          <a href="#layout">Map and list</a>
          <a href="#cards">Map cards</a>
          <a href="#approximate">Approximate pins</a>
        </nav>

        <section aria-labelledby="pins" className={styles.section}>
          <h2 id="pins" className={styles.h2}>
            Pins
          </h2>
          <p className={styles.note}>
            Each pin is a button named for screen readers, e.g. “{`Bounty: ${bounty.title}, ${bounty.suburb}, 3 h left`}”.
            The countdown on a pin ticks, but isn’t announced. Hover or focus a pin to grow it (M21).
          </p>
          <ul className={styles.tiles}>
            <PinTile name="Ready to claim" note="Forest. Worker earnings." job={find("TM-1005")} now={now} />
            <PinTile name="Needs an estimate" note="White. Quote from photos." job={find("TM-1007")} now={now} />
            <PinTile name="Needs a site visit" note="Action colour. In person." job={find("TM-1011")} now={now} />
            <PinTile name="Bounty" note="Gold. Shimmers every 4s (M27)." job={find("TM-1012")} now={now} />
            <PinTile name="Bounty, under 2h" note="Countdown in minutes." job={urgent} now={now} />
            <PinTile name="Bounty, expired" note="Grey, no shimmer." job={expired} now={now} />
            <PinTile name="Hovered" note="Grown 1.15× with the ring (M21)." job={find("TM-1008")} now={now} hot />
            <li className={styles.tile}>
              <MapSurface label="Cluster" className={styles.tileMap}>
                <ClusterPin count={8} position={{ x: 50, y: 50 }} />
              </MapSurface>
              <p className={styles.tileName}>Cluster</p>
              <p className={styles.tileNote}>Jobs too close to show apart.</p>
            </li>
            <li className={styles.tile}>
              <MapSurface label="Cluster with bounties" className={styles.tileMap}>
                <ClusterPin count={128} bounties={3} position={{ x: 50, y: 50 }} />
              </MapSurface>
              <p className={styles.tileName}>Cluster with bounties</p>
              <p className={styles.tileNote}>Gold dot. Over 99 shows “99+”.</p>
            </li>
          </ul>
          <h3 className={styles.h3}>Legend</h3>
          <MapLegend card className={styles.legend} />
        </section>

        <section aria-labelledby="layout" className={styles.section}>
          <h2 id="layout" className={styles.h2}>
            Map and list
          </h2>
          <p className={styles.note}>
            D03 on wide screens (list left, map right), D18 on phones (map, then the list). Hover or focus a row and its
            pin grows, and the reverse. Pick a pin or row to open its card; Esc closes it. Press a cluster to zoom in.
          </p>
          <nav aria-label="Map state" className={styles.states}>
            {STATES.map((s) => (
              <Link key={s.id} href={href({ state: s.id })} aria-current={s.id === state ? "page" : undefined} className={styles.stateLink}>
                {s.name}
              </Link>
            ))}
          </nav>
          <div className={styles.layoutFrame}>
            <MapListLayout
              jobs={state === "empty" ? [] : jobs}
              bounds={boundsAround(jobs.map((j) => j.point), 0.14) ?? undefined}
              serverNow={now}
              state={state}
              headingLevel={3}
              initialSelectedId={bounty.id}
              you={DEMO_YOU}
              approxRadiusMetres={APPROX_MAX_METRES}
              idPrefix="demo-map"
            />
          </div>
        </section>

        <section aria-labelledby="cards" className={styles.section}>
          <h2 id="cards" className={styles.h2}>
            Map cards
          </h2>
          <p className={styles.note}>
            The card over the map. The action (e.g. “Claim bounty”) comes from the button kit (#74) and slots in later.
          </p>
          <ul className={styles.cards}>
            {[find("TM-1005"), find("TM-1007"), find("TM-1011"), bounty, urgent, expired, longJob].map((job) => (
              <li key={job.id}>
                <MapCard job={job} serverNow={now} id={`card-${job.id}`} />
              </li>
            ))}
          </ul>
        </section>

        <ApproximateSection now={now} />
      </main>
    </div>
  );
}

function PinTile({ name, note, job, now, hot = false }: { name: string; note: string; job: MapJob; now: number; hot?: boolean }) {
  return (
    <li className={styles.tile}>
      <MapSurface label={name} className={styles.tileMap}>
        <MapPin job={job} position={{ x: 50, y: 66 }} serverNow={now} hot={hot} />
      </MapSurface>
      <p className={styles.tileName}>{name}</p>
      <p className={styles.tileNote}>{note}</p>
    </li>
  );
}

function ApproximateSection({ now }: { now: number }) {
  const { before, after } = demoClaimPair(now);
  // One view around both points, so the two maps line up.
  const bounds = boundsAround([before.point, after.point], 2.5, 0.008)!;
  const at = (job: DemoJob) => projectPoint(job.point, bounds)!;
  const ring = metresAsWidthPct(APPROX_MAX_METRES * 2, bounds);
  return (
    <section aria-labelledby="approximate" className={styles.section}>
      <h2 id="approximate" className={styles.h2}>
        Approximate pins
      </h2>
      <p className={styles.note}>
        Until a tradie claims a job, its pin is the approximate one stored with the job: {APPROX_MIN_METRES}–
        {APPROX_MAX_METRES} m from the address in a random direction (#97). Every pin on this page comes from{" "}
        <code>jobPinFor()</code>. The dashed ring shows the area it stands for.
      </p>
      <ul className={styles.pair}>
        <li className={styles.tile}>
          <MapSurface label="Before claiming" className={styles.pairMap}>
            <ApproxArea position={at(before)} widthPct={ring} />
            <MapPin job={before} position={at(before)} serverNow={now} />
          </MapSurface>
          <p className={styles.tileName}>Before claiming: approximate</p>
          <p className={styles.tileNote} data-testid="approx-before">
            Pin is {before.metresFromAddress} m from the address.
          </p>
        </li>
        <li className={styles.tile}>
          <MapSurface label="After claiming" className={styles.pairMap}>
            <MapPin job={after} position={at(after)} serverNow={now} />
          </MapSurface>
          <p className={styles.tileName}>After claiming: the address</p>
          <p className={styles.tileNote} data-testid="approx-after">
            Pin is {after.metresFromAddress} m from the address.
          </p>
        </li>
      </ul>
    </section>
  );
}
