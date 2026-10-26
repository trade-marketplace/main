// Buttons and links (#74): the HTML each variant and state renders, and the rules in Button.module.css that the
// design depends on. Clicks, focus, tooltips and layout are checked in the browser: tests/e2e/dev-buttons.spec.ts.
import { readFileSync } from "node:fs";

import { renderToString as renderHtml } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import ButtonsPage from "@/app/dev/components/buttons/page";
import { Button, buttonClasses as hashedClasses, IconButton, TOOLTIP_DELAY_MS } from "@/components/Button";
import { TextLink } from "@/components/TextLink";

// Vitest hashes CSS module class names ("_btn_4f0108"); read them back as the names in the CSS file.
const unhash = (text: string) => text.replace(/\b_([A-Za-z]+)_[0-9a-f]{6}\b/g, "$1");
const renderToString = (node: Parameters<typeof renderHtml>[0]) => unhash(renderHtml(node));
const buttonClasses = (look: Parameters<typeof hashedClasses>[0]) => unhash(hashedClasses(look));

const css = readFileSync(new URL("../../src/components/Button.module.css", import.meta.url), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

/** The declarations of the first rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const match = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((m) =>
    m[1].split(",").map((s) => s.trim()).includes(selector),
  );
  if (!match) throw new Error(`${selector} not found in Button.module.css`);
  return match[2];
}

/** The attributes of the first <tag …> in the HTML. */
function openingTag(html: string, tag: string): string {
  return html.match(new RegExp(`<${tag}\\b[^>]*>`))?.[0] ?? "";
}

describe("<Button>", () => {
  it("is a real <button type=button>, primary, full width on a phone, with the M04 press classes", () => {
    const tag = openingTag(renderToString(<Button>Post a job</Button>), "button");
    expect(tag).toContain('type="button"');
    expect(tag).toMatch(/class="[^"]*\bprimary\b/);
    expect(tag).toMatch(/class="[^"]*\bfullOnPhone\b/);
    expect(tag).toMatch(/class="[^"]*\btm-press tm-press--primary\b/);
    expect(tag).not.toContain("disabled");
    expect(tag).not.toContain("aria-busy");
  });

  it("keeps type=submit when asked, for forms", () => {
    expect(openingTag(renderToString(<Button type="submit">Log in</Button>), "button")).toContain('type="submit"');
  });

  it.each([
    ["primary", "tm-press--primary"],
    ["secondary", "tm-press--secondary"],
    ["tertiary", "tm-press--secondary"],
    ["hero", "tm-press--hero"],
    ["destructive", "tm-press--secondary"],
  ] as const)("has a %s variant with its M04 hover (%s)", (variant, press) => {
    const classes = buttonClasses({ variant }).split(" ");
    expect(classes).toContain(variant);
    expect(classes).toContain(press);
  });

  it("has md and sm sizes; hero and tertiary keep their own height", () => {
    expect(buttonClasses({ size: "sm" }).split(" ")).toContain("sm");
    expect(buttonClasses({ variant: "secondary", size: "sm" }).split(" ")).toContain("sm");
    expect(buttonClasses({ variant: "hero", size: "sm" }).split(" ")).not.toContain("sm");
    expect(buttonClasses({ variant: "tertiary", size: "sm" }).split(" ")).not.toContain("sm");
  });

  it("can be full width, full width on a phone, or its own width; tertiary is always its own width", () => {
    expect(buttonClasses({ width: "full" }).split(" ")).toContain("full");
    expect(buttonClasses({ width: "auto" })).not.toMatch(/\bfull/);
    expect(buttonClasses({ variant: "tertiary", width: "full" })).not.toMatch(/\bfull/);
  });

  it("renders a link that looks like a button when given href", () => {
    const html = renderToString(<Button href="/jobs/new">Post a job</Button>);
    expect(html).toMatch(/^<a [^>]*href="\/jobs\/new"/);
    expect(html).not.toContain("<button");
  });

  it("shows decorative icons beside the label, so the label alone is the name", () => {
    const html = renderToString(
      <Button icon="add_a_photo" iconEnd="arrow_forward">
        Add photos
      </Button>,
    );
    expect(html.match(/aria-hidden="true"[^>]*>(add_a_photo|arrow_forward)</g)).toHaveLength(2);
    expect(html).toContain(">Add photos<");
  });

  describe("loading", () => {
    const html = renderToString(<Button loading>Post job</Button>);
    const tag = openingTag(html, "button");

    it("is busy and can't be pressed again", () => {
      expect(tag).toContain('aria-busy="true"');
      expect(tag).toContain('aria-disabled="true"');
      expect(tag).toMatch(/class="[^"]*\bloading\b/);
    });

    it("keeps the label in place (so the width stays) and in the accessible name, plus “loading”", () => {
      expect(html).toContain(">Post job<");
      expect(html).toContain(", loading");
    });

    it("hides the label with opacity, never visibility or display (either would empty the name or the width)", () => {
      expect(rule(".loading .content")).toMatch(/opacity:\s*0/);
      expect(css).not.toMatch(/\.loading \.content\s*\{[^}]*(visibility|display)/);
      expect(rule(".spinner")).toMatch(/position:\s*absolute/);
    });

    it("spins only with transform, and stands still under reduced motion", () => {
      expect(css).toMatch(/@keyframes spin\s*\{\s*to\s*\{\s*transform: rotate\(360deg\);\s*\}\s*\}/);
      expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.spinner\s*\{\s*animation-name: none;/);
    });
  });

  describe("disabled", () => {
    it("with a reason: aria-disabled (still focusable), described by the reason, which is in a tooltip", () => {
      const html = renderToString(<Button disabled="Add at least one photo first">Next</Button>);
      const tag = openingTag(html, "button");
      expect(tag).toContain('aria-disabled="true"');
      expect(tag).not.toMatch(/\sdisabled=""/);
      const id = tag.match(/aria-describedby="([^"]+)"/)?.[1];
      expect(id).toBeTruthy();
      expect(html).toContain(`<span id="${id}">Add at least one photo first</span>`);
      // The tooltip is hidden until hover, focus or a tap.
      expect(html).toMatch(/<span class="[^"]*\btip\b[^"]*" hidden="">/);
    });

    it("keeps a describedby the caller passed, alongside the reason", () => {
      const tag = openingTag(renderToString(<Button disabled="Not yet" aria-describedby="help">Next</Button>), "button");
      expect(tag).toMatch(/aria-describedby="help [^"]+"/);
    });

    it("with `true`: disabled with no tooltip (the reason is already on screen)", () => {
      const html = renderToString(<Button disabled>Save changes</Button>);
      expect(openingTag(html, "button")).toContain('aria-disabled="true"');
      expect(html).not.toContain("aria-describedby");
      expect(html).not.toMatch(/\btip\b/);
    });

    it("an empty reason counts as no reason", () => {
      expect(renderToString(<Button disabled="  ">Next</Button>)).not.toContain("aria-describedby");
    });

    it("looks disabled, and outranks M04's hover and press so it never brightens, lifts or presses in", () => {
      const look = rule(".btn[data-disabled][aria-disabled]");
      expect(look).toMatch(/background: var\(--trade-waiting-bg\)/);
      expect(look).toMatch(/filter: none/);
      expect(look).toMatch(/transform: none/);
      expect(look).toMatch(/cursor: not-allowed/);
    });
  });

  describe("what if the label is very long?", () => {
    const LONG = "Book Wiremu Te Rangi-Hēnare from Ōtautahi Electrical Services for the switchboard upgrade";

    it("wraps by default: buttons grow (min-height, never a fixed height) and long words break", () => {
      expect(rule(".btn")).toMatch(/min-height: var\(--trade-btn-h\)/);
      expect(rule(".btn")).not.toMatch(/(^|[^-])height:/);
      expect(rule(".btn")).toMatch(/max-width: 100%/);
      expect(rule(".label")).toMatch(/overflow-wrap: anywhere/);
      expect(renderToString(<Button>{LONG}</Button>)).not.toMatch(/\btip\b/);
    });

    it("truncates with “…” when asked, with the whole label in a tooltip and still in the accessible name", () => {
      const html = renderToString(<Button truncate>{LONG}</Button>);
      expect(rule(".truncate .label")).toMatch(/text-overflow: ellipsis/);
      expect(html).toContain(`<span class="label">${LONG}</span>`);
      expect(html).toContain(`<span aria-hidden="true">${LONG}</span>`);
    });

    it("a tooltip never makes the page wider than the screen", () => {
      expect(rule(".tip")).toMatch(/max-width: min\(18rem, calc\(100vw - 2 \* var\(--trade-inset-browse\)\)\)/);
      expect(rule(".tip[hidden]")).toMatch(/display: none/);
    });
  });

  it("shows tooltips after the spec's 500ms hover", () => {
    expect(TOOLTIP_DELAY_MS).toBe(500);
  });
});

describe("mode colours and Forest labels", () => {
  it("fills come from the mode tokens only, so customer / trade / office recolour them", () => {
    expect(rule(".primary")).toMatch(/background: var\(--trade-action\); color: var\(--trade-on-action\)/);
    expect(rule(".secondary")).toMatch(/inset 0 0 0 2px var\(--trade-action\)/);
    expect(rule(".hero")).toMatch(/background: var\(--trade-signature\)/);
    expect(rule(".hero")).toMatch(/color: var\(--trade-on-signature\)/);
    expect(rule(".tertiary")).toMatch(/color: var\(--trade-link\)/);
    expect(rule(".signature")).toMatch(/background: var\(--trade-signature\)/);
    expect(rule(".link")).toMatch(/color: var\(--trade-link\)/);
  });

  it("never uses a raw brand colour that would ignore the mode", () => {
    expect(css).not.toMatch(/--trade-(leaf|lime|hivis|amber|mint|gold)\b/);
  });

  it("labels on coloured fills are the on-action / on-signature tokens (Forest; white on Forest in office)", () => {
    const tokens = readFileSync(new URL("../../src/styles/tokens.css", import.meta.url), "utf8");
    expect(tokens).toMatch(/--trade-on-action: var\(--trade-forest\)/);
    expect(tokens).toMatch(/--trade-on-signature: var\(--trade-forest\)/);
  });
});

describe("<IconButton>", () => {
  it("is named by its label, which is also its (hidden-from-screen-readers) tooltip", () => {
    const html = renderToString(<IconButton icon="close" label="Close" />);
    const tag = openingTag(html, "button");
    expect(tag).toContain('aria-label="Close"');
    expect(tag).toContain('type="button"');
    expect(html).toContain('<span aria-hidden="true">Close</span>');
    expect(html).toMatch(/aria-hidden="true"[^>]*>close</);
  });

  it("reports on/off with aria-pressed, filled when on", () => {
    const on = renderToString(<IconButton icon="favorite" label="Save job" variant="signature" pressed />);
    expect(openingTag(on, "button")).toContain('aria-pressed="true"');
    expect(openingTag(on, "button")).toMatch(/class="[^"]*\bsignature\b/);
    expect(openingTag(renderToString(<IconButton icon="favorite" label="Save job" pressed={false} />), "button")).toContain(
      'aria-pressed="false"',
    );
  });

  it("can be disabled with a reason, like Button", () => {
    const html = renderToString(<IconButton icon="call" label="Call Jack" disabled="No phone number shared" />);
    const id = openingTag(html, "button").match(/aria-describedby="([^"]+)"/)?.[1];
    expect(html).toContain(`<span id="${id}" class="tipReason">No phone number shared</span>`);
    expect(openingTag(html, "button")).toContain('aria-disabled="true"');
  });

  it("is at least the 44px tap size", () => {
    expect(rule(".plain")).toMatch(/width: var\(--trade-tap\); height: var\(--trade-tap\)/);
  });
});

describe("<TextLink>", () => {
  it("is an <a> in the link colour, 44px tall to tap", () => {
    const html = renderToString(<TextLink href="/recovery">Forgot password?</TextLink>);
    expect(html).toBe('<a class="link" href="/recovery">Forgot password?</a>');
    expect(rule(".link")).toMatch(/min-height: var\(--trade-tap\)/);
  });

  it("inside text is always underlined, so it isn't told apart by colour alone", () => {
    expect(renderToString(<TextLink href="/legal/terms" inline>terms</TextLink>)).toContain('class="link linkInline"');
    expect(rule(".linkInline")).toMatch(/text-decoration: underline/);
  });

  it("to another site opens a new tab safely and says so", () => {
    const html = renderToString(
      <TextLink href="https://example.org" external>
        Example
      </TextLink>,
    );
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("(opens in a new tab)");
  });
});

describe("/dev/components/buttons", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const render = async (params: Record<string, string> = {}) =>
    renderToString(await ButtonsPage({ searchParams: Promise.resolve(params) }));

  it("is a 404 in production builds", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(render()).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });

  it("shows every variant, state, icon button, link, long label, width and the usage example", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const html = await render();
    for (const id of ["variants", "sizes", "states", "icon-buttons", "links", "long-labels", "widths", "usage"]) {
      expect(html, id).toContain(`id="${id}"`);
    }
    for (const state of ["Default", "Hover", "Pressed", "Loading", "Disabled"]) {
      expect(html.match(new RegExp(`>${state}</span>`, "g")), state).toHaveLength(5);
    }
    expect(html).toContain("import { Button } from &quot;@/components/Button&quot;");
  });

  it("can be seen in each mode and ignores unknown modes", async () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(await render({ mode: "trade" })).toMatch(/^<div[^>]*data-mode="trade"/);
    expect(await render({ mode: "office" })).toMatch(/^<div[^>]*data-mode="office"/);
    expect(await render({ mode: "purple" })).toMatch(/^<div[^>]*data-mode="customer"/);
  });
});
