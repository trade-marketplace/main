import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import StatusComponentsPage from "@/app/dev/components/status/page";
import { JOB_STATUSES } from "@/lib/job-status";

const render = async (params: Record<string, string> = {}) =>
  renderToString(await StatusComponentsPage({ searchParams: Promise.resolve(params) }));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("/dev/components/status", () => {
  it("is a 404 in production builds", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(render()).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });

  it("shows a pill row for every status in the schema", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const html = await render();
    for (const status of JOB_STATUSES) expect(html, status).toContain(`<code>${status}</code>`);
    expect(html).toContain("Getting your price");
    expect(html).toContain("Needs your OK");
  });

  it("shows each mode's labels in its colours, and ignores unknown modes", async () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(await render({ mode: "trade" })).toMatch(/^<div[^>]*data-mode="trade"/);
    expect(await render({ mode: "trade" })).toContain("Tradie<!-- --> pill");
    expect(await render({ mode: "office" })).toContain("Office<!-- --> pill");
    expect(await render({ mode: "purple" })).toMatch(/^<div[^>]*data-mode="customer"/);
  });

  it("has a section for every component and animation", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const html = await render();
    for (const id of ["pills", "kinds", "bounty", "m25", "tracker", "m11", "price", "m09", "long", "usage"]) {
      expect(html, id).toContain(`id="${id}"`);
    }
  });
});
