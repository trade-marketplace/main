import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MapListLayout } from "@/components/map/MapListLayout";
import { MapLegend } from "@/components/map/MapSurface";
import type { MapJob } from "@/lib/map/pins";
const provider = vi.hoisted(() => ({ props: null as Record<string, unknown> | null }));
vi.mock("@/components/map/MapboxSurface", () => ({ MapboxSurface: (props: Record<string, unknown>) => { provider.props = props; return <div>{String(props.locationNote ?? "")}{props.children as React.ReactNode}</div>; } }));
const now = 1_800_000_000_000;
const jobs: MapJob[] = [{ id: "first", kind: "claim", title: "First job", suburb: "Windsor", point: { lat: -46.41, lng: 168.35 }, precision: "approximate", earnCents: 6400 },
  { id: "second", kind: "estimate", title: "Second job", suburb: "Gladstone", point: { lat: -46.39, lng: 168.37 }, precision: "approximate" }];
const mapbox = { accessToken: null, workArea: { name: "Example", centre: jobs[0].point, radiusKm: 10 } };
describe("optional map layout hooks", () => {
  it("controlled selection wins over the initial selection and custom links reach the card", () => {
    const html = renderToStaticMarkup(<MapListLayout jobs={jobs} serverNow={now} selectedId="second" initialSelectedId="first" jobHref={job => "/custom/" + job.id} />);
    expect(html).toContain('href="/custom/second"'); expect(html).not.toContain('href="/custom/first"');
    expect(html).toContain('data-card-kind="estimate"');
  });
  it("forwards job hrefs to rows in the provider fallback", () => {
    const html = renderToStaticMarkup(<MapListLayout jobs={jobs} serverNow={now} mapbox={mapbox} jobHref={job => "/custom/" + job.id} />);
    expect(html).toContain('href="/custom/first"'); expect(html).toContain('href="/custom/second"');
  });
  it("the caller can close both responsive legend presentations without replacing kit legend markup", () => {
    const render = (open: boolean) => renderToStaticMarkup(<MapListLayout jobs={jobs} serverNow={now} legend={{ open, onDismiss: () => {} }} />);
    expect(render(false)).not.toContain("What the pins mean"); expect(render(true)).toContain("What the pins mean"); expect(render(true)).toContain("Close map legend");
  });
  it("forwards location wording and viewport bounds from the existing provider", () => {
    const report = vi.fn(); renderToStaticMarkup(<MapListLayout jobs={jobs} serverNow={now} mapbox={{ ...mapbox, accessToken: "pk.fixture" }} locationNote="Caller work area" onViewChange={report} />);
    expect(provider.props?.locationNote).toBe("Caller work area");
    const bounds = { north: -46, south: -47, east: 169, west: 168 };
    (provider.props?.onViewChange as (view: unknown) => void)({ bounds, project: () => null });
    expect(report).toHaveBeenCalledWith(bounds);
  });
  it("legend callers can describe only their supported kinds and configured amounts, keeping defaults intact", () => {
    const original = renderToStaticMarkup(<MapLegend />); expect(original).toContain("$30"); expect(original).toContain("24h."); expect(original).toContain("Visit");
    const custom = renderToStaticMarkup(<MapLegend items={[{ kind: "bounty", sample: "$45", text: "Go quote in person. $45 on the spot. 36h." }]} />);
    expect(custom).toContain("$45"); expect(custom).toContain("36h."); expect(custom).not.toContain("Visit"); expect(custom).not.toContain("$30");
  });
});
