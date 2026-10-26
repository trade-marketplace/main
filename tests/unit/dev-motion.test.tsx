import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import MotionPage from "@/app/dev/motion/page";
import { BoltFlash, SPARK_ANGLES } from "@/components/motion/BoltFlash";
import { CountUp, formatNzd } from "@/components/motion/CountUp";
import { MOTION } from "@/lib/motion/catalogue";

const render = async (params: Record<string, string> = {}) =>
  renderToString(await MotionPage({ searchParams: Promise.resolve(params) }));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("/dev/motion", () => {
  it("is a 404 in production builds", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(render()).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });

  it("has a play button for every animation, labelled with its M-number and name", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const html = await render();
    for (const m of MOTION) {
      expect(html, m.id).toContain(`Play <!-- -->${m.id}<!-- --> · <!-- -->${m.name.replace("&", "&amp;")}`);
      expect(html, m.id).toContain(`id="${m.id.toLowerCase()}"`);
    }
    expect(html.match(/Play <!-- -->M\d\d/g)).toHaveLength(27);
  });

  it("shows the spec text for each one", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const html = await render();
    expect(html).toContain("Card rises 2px, shadow deepens to 0 10 24 / 18%.");
    expect(html).toContain("300ms every 4s");
  });

  it("server-renders the end state: no animation class is on until someone presses Play", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const html = await render();
    expect(html).not.toMatch(/class="[^"]*\btm-anim-(rise|reveal|wipe|pin|status|tick)\b/);
    expect(html).not.toContain("is-playing");
  });

  it("can be seen in each mode and ignores unknown modes", async () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(await render({ mode: "trade" })).toMatch(/^<div[^>]*data-mode="trade"/);
    expect(await render({ mode: "purple" })).toMatch(/^<div[^>]*data-mode="customer"/);
  });
});

describe("<BoltFlash> (M10)", () => {
  it("is decorative, has 8 sparks, and never plays in the server HTML (refreshes don't replay it)", () => {
    const html = renderToString(<BoltFlash eventId="posted:job-1" />);
    expect(html).toMatch(/^<div class="tm-flash" aria-hidden="true" data-playing="false">/);
    expect(html.match(/<i style="--a:\d+deg"/g)).toHaveLength(SPARK_ANGLES.length);
    expect(SPARK_ANGLES).toHaveLength(8);
    expect(html).toContain("check");
  });

  it("can show the bolt for tradies' wins", () => {
    expect(renderToString(<BoltFlash eventId={null} mark="bolt" />)).toContain('class="tm-flash__bolt"');
  });
});

describe("<CountUp> (M09, M17)", () => {
  it("server-renders the final value, and screen readers only get the final value", () => {
    const html = renderToString(<CountUp value={372} format={formatNzd} />);
    expect(html).toContain('<span aria-hidden="true">$372.00</span>');
    expect(html.match(/\$372\.00/g)).toHaveLength(2);
  });

  it("formats money like the mockups", () => {
    expect(formatNzd(372)).toBe("$372.00");
    expect(formatNzd(1284.5)).toBe("$1,284.50");
  });
});
