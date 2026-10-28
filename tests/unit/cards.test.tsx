// Cards, tiles and rows (#76): the rules in src/lib/cards.ts, the HTML each component renders, and the CSS the
// design depends on. Hover, Save, focus, layout at every width and axe are checked in the browser:
// tests/e2e/dev-cards.spec.ts.
import { readFileSync } from "node:fs";

import { renderToString as renderHtml } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import CardsPage from "@/app/dev/components/cards/page";
import {
  CATEGORIES,
  CategoryRail,
  CategoryTile,
  EmptyCard,
  JobRow,
  JobTile,
  KpiCard,
  ProfileCard,
  StatCard,
  StatStrip,
} from "@/components/cards";
import { CATEGORY_INFO, initials, isCategory, tileMeta } from "@/lib/cards";
import { formatKm } from "@/lib/geo/distance";

// Vitest hashes CSS module class names ("_tile_4f0108"); read them back as the names in the CSS file.
const unhash = (text: string) => text.replace(/\b_([A-Za-z-]+)_[0-9a-f]{6}\b/g, "$1");
const renderToString = (node: Parameters<typeof renderHtml>[0]) => unhash(renderHtml(node)).replace(/<!-- -->/g, "");
const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

describe("the rules", () => {
  it("has the four trades and Other, worded as in the mockups", () => {
    expect(CATEGORIES).toEqual(["electrical", "plumbing", "construction", "gas", "other"]);
    expect(CATEGORIES.map((c) => CATEGORY_INFO[c].name)).toEqual(["Electrical", "Plumbing", "Construction", "Gas fitting", "Other"]);
    expect(CATEGORY_INFO.other.sub).toBe("anything else");
    expect(isCategory("plumbing")).toBe(true);
    expect(isCategory("lasers")).toBe(false);
  });

  it("every category's tint is a token, and every image exists", () => {
    const tokens = read("src/styles/tokens.css");
    for (const category of CATEGORIES) {
      const { tint, art } = CATEGORY_INFO[category];
      expect(tokens).toContain(`${tint.slice(4, -1)}:`);
      if ("image" in art) expect(() => readFileSync(new URL(`../../public${art.image}`, import.meta.url))).not.toThrow();
    }
  });

  it("initials are the first letters of the first and last names", () => {
    expect(initials("Jack Wilson")).toBe("JW");
    expect(initials("Jack W.")).toBe("JW");
    expect(initials("Wiremu Te Rangi-Hēnare")).toBe("WR");
    expect(initials("mere")).toBe("M");
    expect(initials("ōtautahi builders")).toBe("ŌB");
    expect(initials("  ")).toBe("?");
  });

  it("the tile line joins whatever's known", () => {
    expect(tileMeta(formatKm(3.6), "Windsor")).toBe("4 km · Windsor");
    expect(tileMeta(formatKm(0.2), null)).toBe("<1 km");
    expect(tileMeta(undefined, " Bluff ")).toBe("Bluff");
    expect(tileMeta()).toBe("");
  });
});

describe("<JobTile>", () => {
  const tile = (props: Partial<Parameters<typeof JobTile>[0]> = {}) =>
    renderToString(<JobTile href="/jobs/1" title="Sub wiring" meta="4 km · Windsor" photo="/p.jpg" tag={{ kind: "earn", text: "Earn $259" }} {...props} />);

  it("is one link, the title in a heading, stretched over the tile, with the tag as its description", () => {
    const html = tile();
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toMatch(/<h3 class="tileHeading"><a class="tileTitle stretched" title="Sub wiring" aria-describedby="([^"]+)" href="\/jobs\/1">Sub wiring<\/a><\/h3>/);
    const id = /aria-describedby="([^"]+)"/.exec(html)![1];
    expect(html).toContain(`data-kind="earn" id="${id}">Earn $259`);
    expect(html).toContain("4 km · Windsor");
    expect(html).toMatch(/<img class="tm-zoom__img tilePhoto" src="\/p.jpg" alt=""/);
    expect(html).toContain('class="tm-lift tileWrap"');
  });

  it("words each kind of tag", () => {
    expect(tile({ tag: { kind: "estimate" } })).toContain(">Needs estimate</span>");
    expect(tile({ tag: { kind: "estimated" } })).toMatch(/>bolt<\/span>Estimated<\/span>/);
    expect(tile({ tag: { kind: "bounty", text: "Bounty $30 · 17h" } })).toContain(">Bounty $30 · 17h</span>");
    expect(tile({ tag: undefined })).not.toContain("aria-describedby");
  });

  it("no photo: Forest with the bolt", () => {
    const html = tile({ photo: null });
    expect(html).not.toContain("<img");
    expect(html).toContain("tileBolt");
  });

  it("Save sits outside the tile's clipping box, so its focus ring and tooltip aren't cut off", () => {
    const html = tile({ onSavedChange: () => {} });
    expect(html).toMatch(/<\/div><\/div><span class="tileSave">.*Save Sub wiring/);
  });

  it("Save is a toggle named after the job; without onSavedChange there's no Save", () => {
    expect(tile({ onSavedChange: () => {}, saved: true })).toMatch(/aria-label="Save Sub wiring" aria-pressed="true"/);
    expect(tile({ onSavedChange: () => {}, saved: false })).toMatch(/aria-label="Save Sub wiring" aria-pressed="false"/);
    expect(tile()).not.toContain("Save Sub wiring");
  });

  it("the desktop board's tall shape, and the heading level fits the page", () => {
    expect(tile({ shape: "tall" })).toContain('data-shape="tall"');
    expect(tile({ headingLevel: 2 })).toContain('<h2 class="tileHeading">');
  });
});

describe("<CategoryTile>", () => {
  it("links the name; the art is decorative", () => {
    const html = renderToString(<CategoryTile category="electrical" href="/jobs/new?type=electrical" />);
    expect(html).toMatch(/<h3 class="catName"><a class="stretched" href="\/jobs\/new\?type=electrical">Electrical<\/a><\/h3>/);
    expect(html).toMatch(/class="catArt" style="background:var\(--trade-cat-electrical\)"[^>]*aria-hidden="true"/);
    expect(html).toContain('alt=""');
    expect(html).not.toContain("and related");
    expect(html).toContain("tm-lift");
  });

  it("icon categories use their own ink", () => {
    const html = renderToString(<CategoryTile category="gas" href="/x" />);
    expect(html).toContain("--cat-ink:var(--trade-cat-gas-ink)");
    expect(html).toContain(">local_fire_department<");
  });

  it("disabled: not a link, no lift, and the reason in place of the second line", () => {
    const html = renderToString(<CategoryTile category="plumbing" href="/x" disabled="Not verified" />);
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("tm-lift");
    expect(html).toContain('data-disabled="true"');
    expect(html).toContain('title="Not verified">Not verified</span>');
  });

  it("the rail is a labelled list", () => {
    expect(renderToString(<CategoryRail label="What needs doing?"><li>x</li></CategoryRail>)).toMatch(/^<ul aria-label="What needs doing\?" class="rail">/);
  });
});

describe("<JobRow>", () => {
  it("one stretched link with the whole title as its tooltip; price and action at the end", () => {
    const html = renderToString(
      <JobRow href="/jobs/1" title="Sub wiring" category="Electrical" meta="Windsor · TM-1005" photo="/p.jpg" price="$372.00"
        status={<span>Price ready</span>} action={<button type="button">See price</button>} />,
    );
    expect(html).toMatch(/<a class="rowTitle stretched" title="Sub wiring" href="\/jobs\/1">Sub wiring<\/a>/);
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toContain('class="rowPrice">$372.00');
    expect(html).toContain('<span class="rowAction"><button type="button">See price</button>');
    expect(html).toContain('<span class="rowStatus"><span>Price ready</span>');
  });

  it("leaves out what it isn't given", () => {
    const html = renderToString(<JobRow href="/jobs/1" title="Sub wiring" />);
    expect(html).not.toContain("rowEnd");
    expect(html).not.toContain("rowCat");
    expect(html).not.toContain("<img");
  });
});

describe("numbers", () => {
  it("KPI: label, value, note; overdue is marked; a linked card links its label", () => {
    const html = renderToString(<KpiCard label="To price" value="4" note="oldest 26h" alert href="/admin?tab=price" />);
    expect(html).toContain('data-alert="true"');
    expect(html).toMatch(/<a class="kpiLabel stretched" href="\/admin\?tab=price">To price<\/a>/);
    expect(html).toContain('class="kpiValue">4<');
    expect(html).toContain('class="kpiNote">oldest 26h<');
    expect(renderToString(<KpiCard label="Paid" value="$1" />)).not.toContain("<a ");
  });

  it("numbers count up, but the server's HTML already has the final value", () => {
    expect(renderToString(<KpiCard label="Paid" value={3452.8} format={(v) => `$${v.toFixed(2)}`} />)).toContain("$3452.80");
    expect(renderToString(<StatCard label="Paid in October" value={1284} />)).toContain("1,284");
  });

  it("the stats strip is a description list", () => {
    const html = renderToString(<StatStrip items={[{ label: "rating", value: "4.9" }, { label: "jobs", value: "32" }]} />);
    expect(html).toBe('<dl class="stats"><div><dt>rating</dt><dd>4.9</dd></div><div><dt>jobs</dt><dd>32</dd></div></dl>');
  });
});

describe("<ProfileCard> and <EmptyCard>", () => {
  it("initials without a photo, a named section, a heading, badges and stats", () => {
    const html = renderToString(
      <ProfileCard name="Jack W." meta="Electrician · Invercargill" variant="card" badges={<span>Licence checked</span>} stats={[{ label: "jobs", value: "32" }]} />,
    );
    expect(html).toMatch(/^<section class="profile" data-variant="card" aria-label="Jack W.">/);
    expect(html).toContain('class="avatar" aria-hidden="true">JW</span>');
    expect(html).toContain('<h1 class="profileName">Jack W.</h1>');
    expect(html).toContain("Licence checked");
    expect(html).toContain("<dt>jobs</dt>");
  });

  it("the empty card is the kit's empty state in a flat card, with an h3", () => {
    const html = renderToString(<EmptyCard icon="inbox" title="Nothing on yet." />);
    expect(html).toMatch(/^<div class="emptyCard">/);
    expect(html).toMatch(/<h3[^>]*>Nothing on yet.<\/h3>/);
  });
});

describe("the CSS", () => {
  const css = read("src/components/cards/cards.module.css");

  it("uses tokens only: no hex colours", () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it("one link per card: the title's ::after covers the card", () => {
    expect(css).toMatch(/\.stretched::after \{ content: ""; position: absolute; inset: 0;/);
  });

  it("clamps tile titles to two lines (plus the line above) and row titles to one", () => {
    expect(css).toMatch(/\.tileTitle \{[^}]*-webkit-line-clamp: 2;/);
    expect(css).toMatch(/\.rowTitle \{[^}]*white-space: nowrap;[^}]*text-overflow: ellipsis;/);
  });

  it("the sizes from FRONTEND_SPEC: category tile 159 × 162, row photo 64, the desktop board's 191 × 220", () => {
    expect(css).toMatch(/\.cat \{[^}]*width: 159px;[^}]*height: 162px;/);
    expect(css).toMatch(/\.rowThumb \{[^}]*width: 64px;[^}]*height: 64px;/);
    expect(css).toContain("aspect-ratio: 191 / 220");
  });

  it("bounty tags are gold (AGENTS.md: quote bounties are gold)", () => {
    expect(css).toMatch(/\.tileTag\[data-kind="bounty"\] \{ background: var\(--trade-gold\); color: var\(--trade-on-gold\); \}/);
  });

  it("overdue KPIs get the red top edge", () => {
    expect(css).toMatch(/\.kpi\[data-alert\] \{[^}]*var\(--trade-danger\)/);
  });
});

describe("/dev/components/cards", () => {
  const render = async (params: Record<string, string> = {}) => renderToString(await CardsPage({ searchParams: Promise.resolve(params) }));

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is a 404 in production builds", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(render()).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });

  it("has every section, and each mode's palette", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const html = await render();
    for (const id of ["categories", "tiles", "rows", "numbers", "profiles", "empty", "usage"]) expect(html, id).toContain(`id="${id}"`);
    expect(html).toMatch(/^<div[^>]*data-mode="customer"/);
    expect(await render({ mode: "office" })).toMatch(/^<div[^>]*data-mode="office"/);
    expect(await render({ mode: "purple" })).toMatch(/^<div[^>]*data-mode="customer"/);
  });
});
