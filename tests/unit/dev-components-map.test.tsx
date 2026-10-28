import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import MapComponentsPage from "@/app/dev/components/map/page";
import { DEMO_VIEWER_ID, demoClaimPair, demoJobs } from "@/app/dev/components/map/demo-jobs";
import { MapCard } from "@/components/map/MapCard";
import { ClusterPin, MapPin } from "@/components/map/MapPin";
import type { MapJob } from "@/lib/map/pins";
import { APPROX_MAX_METRES, APPROX_MIN_METRES } from "@/server/geo/approximate";

const render = async (params: Record<string, string> = {}) =>
  renderToString(await MapComponentsPage({ searchParams: Promise.resolve(params) }));

const HOUR = 3_600_000;
const NOW = 1_800_000_000_000;
const point = { lat: -46.39, lng: 168.35 };
const bounty: MapJob = {
  id: "b",
  kind: "bounty",
  title: "Hot water cylinder",
  suburb: "Gladstone",
  point,
  precision: "approximate",
  bountyCents: 3000,
  endsAt: NOW + 3 * HOUR + 600_000,
  durationMs: 24 * HOUR,
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("/dev/components/map", () => {
  it("is a 404 in production builds", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(render()).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });

  it("shows every pin variant, the cluster, the legend, the layout and the cards", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const html = await render();
    for (const kind of ["claim", "estimate", "visit", "bounty", "cluster"]) {
      expect(html, kind).toContain(`data-pin-kind="${kind}"`);
    }
    expect(html).toContain("Bounty, expired");
    expect(html).toContain("What the pins mean");
    expect(html).toContain("13 jobs in view");
    expect(html).toContain('data-card-kind="bounty"');
  });

  it("opens in trade mode and switches mode with ?mode=", async () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(await render()).toContain('data-mode="trade"');
    expect(await render({ mode: "office" })).toContain('data-mode="office"');
    expect(await render({ mode: "nonsense" })).toContain('data-mode="trade"');
  });

  it("builds the loading, empty and error states with ?state=", async () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(await render({ state: "loading" })).toContain("Loading jobs");
    expect(await render({ state: "empty" })).toContain("No jobs");
    expect(await render({ state: "error" })).toContain("Couldn’t load jobs");
  });

  it("never makes a countdown a live region", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const html = await render();
    expect(html).not.toContain("aria-live");
    expect(html).not.toContain('role="timer"');
  });

  it("puts every pin at its approximate point (#97) for a tradie who hasn't claimed the job", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const html = await render();
    expect(html.match(/data-precision="exact"/g)).toHaveLength(1); // the "after claiming" example only
  });
});

describe("demo jobs", () => {
  it("only gives an unclaimed job its approximate pin, 100–300 m from the address", () => {
    for (const job of demoJobs(NOW)) {
      expect(job.precision, job.id).toBe("approximate");
      expect(job.metresFromAddress, job.id).toBeGreaterThanOrEqual(APPROX_MIN_METRES - 1);
      expect(job.metresFromAddress, job.id).toBeLessThanOrEqual(APPROX_MAX_METRES + 1);
    }
  });

  it("shows the address only to the tradie who claimed it", () => {
    const { before, after } = demoClaimPair(NOW);
    expect(before.precision).toBe("approximate");
    expect(before.metresFromAddress).toBeGreaterThanOrEqual(APPROX_MIN_METRES - 1);
    expect(after.precision).toBe("exact");
    expect(after.metresFromAddress).toBe(0);
    expect(DEMO_VIEWER_ID).toBeTruthy();
  });
});

describe("<MapPin>", () => {
  it("is a button named for screen readers, with the ticking text hidden from them", () => {
    const html = renderToString(<MapPin job={bounty} position={{ x: 10, y: 20 }} serverNow={NOW} />);
    expect(html).toContain("<button");
    expect(html).toContain('aria-label="Bounty: Hot water cylinder, Gladstone, 3 h left"');
    expect(html).toContain('<span aria-hidden="true">$30 · 3h 10m</span>');
  });

  it("shimmers a live bounty (M27) and grows when hot (M21)", () => {
    const html = renderToString(<MapPin job={bounty} position={{ x: 10, y: 20 }} serverNow={NOW} hot />);
    expect(html).toMatch(/class="[^"]*tm-pin[^"]*tm-glint[^"]*is-hot/);
  });

  it("stops shimmering and says Expired once the bounty is over", () => {
    const html = renderToString(<MapPin job={bounty} position={{ x: 10, y: 20 }} serverNow={NOW + 4 * HOUR} />);
    expect(html).not.toContain("tm-glint");
    expect(html).toContain("$30 · Expired");
    expect(html).toContain('aria-label="Bounty: Hot water cylinder, Gladstone, expired"');
  });

  it("places the pin with rounded positions, so server and browser HTML agree", () => {
    const html = renderToString(<MapPin job={bounty} position={{ x: 22.335518428, y: 51.72423 }} serverNow={NOW} />);
    expect(html).toContain("left:22.34%;top:51.72%");
  });

  it("names a cluster", () => {
    const html = renderToString(<ClusterPin count={128} bounties={3} position={{ x: 1, y: 1 }} />);
    expect(html).toContain('aria-label="128 jobs here, 3 of them bounties. Zoom in to see them"');
    expect(html).toContain("99+");
  });
});

describe("<MapCard>", () => {
  it("shows a bounty's countdown ring named with the time left, pulsing under 2h", () => {
    const html = renderToString(<MapCard job={bounty} serverNow={NOW} />);
    expect(html).toContain('role="img" aria-label="3 h left"');
    expect(html).not.toContain("tm-ring-urgent");
    const urgent = renderToString(<MapCard job={bounty} serverNow={bounty.endsAt - 30 * 60_000} />);
    expect(urgent).toContain("tm-ring-urgent");
  });

  it("says when the bounty has ended", () => {
    const html = renderToString(<MapCard job={bounty} serverNow={bounty.endsAt} />);
    expect(html).toContain("Bounty expired");
    expect(html).toContain('aria-label="expired"');
  });

  it("tells the tradie the pin is approximate until they claim", () => {
    expect(renderToString(<MapCard job={bounty} serverNow={NOW} />)).toContain("Approximate area");
    expect(renderToString(<MapCard job={{ ...bounty, precision: "exact" }} serverNow={NOW} />)).not.toContain(
      "Approximate area",
    );
  });
});
