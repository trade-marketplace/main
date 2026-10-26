// Overlays (#78): the rules in src/lib/overlays.ts, the HTML each component renders, and the CSS rules the design
// depends on. Focus, keyboard, swiping, timing and layout are checked in the browser: tests/e2e/dev-overlays.spec.ts.
import { readFileSync } from "node:fs";

import { renderToString as renderHtml } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import OverlaysPage from "@/app/dev/components/overlays/page";
import { OPEN_IDS } from "@/app/dev/components/overlays/preview-data";
import { IconButton } from "@/components/Button";
import {
  Banner,
  BANNER_ICONS,
  ConfirmDialog,
  Dialog,
  Drawer,
  Menu,
  MenuItem,
  MenuSeparator,
  Sheet,
  ToastProvider,
  useToast,
} from "@/components/overlays";
import { EXIT_MS, MOTION_MS } from "@/lib/motion/timings";
import {
  dismissToast,
  EMPTY_TOASTS,
  menuKey,
  sheetShouldClose,
  shiftIntoView,
  showToast,
  trapTab,
  typeaheadIndex,
} from "@/lib/overlays";

// Vitest hashes CSS module class names ("_dialog_4f0108"); read them back as the names in the CSS file.
const unhash = (text: string) => text.replace(/\b_([A-Za-z-]+)_[0-9a-f]{6}\b/g, "$1");
const renderToString = (node: Parameters<typeof renderHtml>[0]) => unhash(renderHtml(node));

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const css = read("src/components/overlays/overlays.module.css");
const motionCss = read("src/styles/motion.css");

/** The declarations of the first rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const match = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((m) =>
    m[1].split(",").map((s) => s.trim()).includes(selector),
  );
  if (!match) throw new Error(`${selector} not found in overlays.module.css`);
  return match[2];
}

/** The attributes of the first <tag …> in the HTML. */
function openingTag(html: string, tag: string): string {
  return html.match(new RegExp(`<${tag}\\b[^>]*>`))?.[0] ?? "";
}

const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];

describe("trapTab: the focus trap", () => {
  it("wraps Tab from the last control to the first, and Shift+Tab from the first to the last", () => {
    expect(trapTab(3, 2, false)).toBe(0);
    expect(trapTab(3, 0, true)).toBe(2);
  });

  it("lets the browser move between the controls in the middle", () => {
    expect(trapTab(3, 0, false)).toBeNull();
    expect(trapTab(3, 2, true)).toBeNull();
  });

  it("from the title (not a control), Tab goes to the first control and Shift+Tab to the last", () => {
    expect(trapTab(3, -1, false)).toBe(0);
    expect(trapTab(3, -1, true)).toBe(2);
  });

  it("keeps focus where it is when there is nothing to Tab to", () => {
    expect(trapTab(0, -1, false)).toBe("stay");
    expect(trapTab(0, -1, true)).toBe("stay");
  });
});

describe("menuKey: keys in an open menu", () => {
  it("moves with the arrows, wrapping at both ends", () => {
    expect(menuKey("ArrowDown", 0, 4)).toEqual({ focus: 1 });
    expect(menuKey("ArrowDown", 3, 4)).toEqual({ focus: 0 });
    expect(menuKey("ArrowUp", 0, 4)).toEqual({ focus: 3 });
    expect(menuKey("ArrowUp", 2, 4)).toEqual({ focus: 1 });
  });

  it("jumps with Home and End", () => {
    expect(menuKey("Home", 2, 4)).toEqual({ focus: 0 });
    expect(menuKey("End", 0, 4)).toEqual({ focus: 3 });
  });

  it("starts from either end when nothing is focused yet", () => {
    expect(menuKey("ArrowDown", -1, 4)).toEqual({ focus: 0 });
    expect(menuKey("ArrowUp", -1, 4)).toEqual({ focus: 3 });
  });

  it("closes on Esc (back to the button) and on Tab (focus moves on)", () => {
    expect(menuKey("Escape", 1, 4)).toEqual({ close: "escape" });
    expect(menuKey("Tab", 1, 4)).toEqual({ close: "tab" });
    expect(menuKey("Escape", -1, 0)).toEqual({ close: "escape" });
  });

  it("ignores other keys, and arrows in an empty menu", () => {
    expect(menuKey("x", 1, 4)).toBeNull();
    expect(menuKey("ArrowDown", -1, 0)).toBeNull();
  });
});

describe("typeaheadIndex: typing the first letters", () => {
  const labels = ["Account", "Payments", "Notification settings", "Help", "Log out", "Privacy"];

  it("moves to the next item starting with the letter", () => {
    expect(typeaheadIndex(labels, 0, "h")).toBe(3);
    expect(typeaheadIndex(labels, 0, "P")).toBe(1);
  });

  it("the same letter again moves on to the next match, wrapping round", () => {
    expect(typeaheadIndex(labels, 1, "p")).toBe(5);
    expect(typeaheadIndex(labels, 5, "pp")).toBe(1);
  });

  it("several letters narrow it down, keeping the current item if it still matches", () => {
    expect(typeaheadIndex(labels, 1, "pr")).toBe(5);
    expect(typeaheadIndex(labels, 2, "no")).toBe(2);
  });

  it("returns -1 when nothing matches", () => {
    expect(typeaheadIndex(labels, 0, "z")).toBe(-1);
    expect(typeaheadIndex([], 0, "a")).toBe(-1);
  });
});

describe("sheetShouldClose: swiping a bottom sheet down", () => {
  it("closes after a quarter of its height, at most 120px", () => {
    expect(sheetShouldClose(100, 1000, 400)).toBe(true);
    expect(sheetShouldClose(99, 1000, 400)).toBe(false);
    expect(sheetShouldClose(120, 1000, 800)).toBe(true);
  });

  it("closes on a quick flick, but not a twitch", () => {
    expect(sheetShouldClose(40, 50, 800)).toBe(true);
    expect(sheetShouldClose(20, 10, 800)).toBe(false);
  });

  it("never closes when dragged up or not at all", () => {
    expect(sheetShouldClose(0, 10, 400)).toBe(false);
    expect(sheetShouldClose(-200, 10, 400)).toBe(false);
  });
});

describe("shiftIntoView: keeping a menu on a 320px screen", () => {
  it("leaves it alone when it fits", () => {
    expect(shiftIntoView(20, 300, 320)).toBe(0);
  });

  it("slides it left or right back inside the 16px gutter", () => {
    expect(shiftIntoView(100, 340, 320)).toBe(-36);
    expect(shiftIntoView(-40, 200, 320)).toBe(56);
  });

  it("never pushes a menu wider than the screen off its left edge", () => {
    expect(shiftIntoView(10, 400, 320)).toBe(6);
  });
});

describe("the toast queue", () => {
  it("shows one toast at a time; a new one replaces it with a new id", () => {
    const first = showToast(EMPTY_TOASTS, { message: "Saved." });
    const second = showToast(first, { message: "Link copied." });
    expect(first.current).toEqual({ message: "Saved.", id: 1 });
    expect(second.current).toEqual({ message: "Link copied.", id: 2 });
  });

  it("dismisses only the toast that is showing", () => {
    const first = showToast(EMPTY_TOASTS, { message: "Saved." });
    const second = showToast(first, { message: "Link copied." });
    expect(dismissToast(second, 1)).toBe(second);
    expect(dismissToast(second, 2).current).toBeNull();
  });

  it("lasts 4 seconds and animates out in 200ms (M14)", () => {
    expect(MOTION_MS.m14Life).toBe(4000);
    expect(EXIT_MS.toast).toBe(200);
  });
});

describe("<Dialog>", () => {
  const dialog = (props: Partial<Parameters<typeof Dialog>[0]> = {}) =>
    renderToString(
      <Dialog open title="Jack found extra work" onClose={() => {}} {...props}>
        <p>The switchboard needs a new breaker.</p>
      </Dialog>,
    );

  it("renders nothing while closed", () => {
    expect(renderToString(<Dialog open={false} title="Hidden" onClose={() => {}} />)).toBe("");
  });

  it("is a native <dialog> named by its title, with the M13 animation", () => {
    const html = dialog();
    const tag = openingTag(html, "dialog");
    expect(tag).toMatch(/class="[^"]*\bmodal dialog md tm-anim-dialog\b/);
    expect(tag).not.toContain("role=");
    const h2 = openingTag(html, "h2");
    expect(attr(h2, "id")).toBe(attr(tag, "aria-labelledby"));
    expect(h2).toContain('tabindex="-1"'); // focus starts here
    expect(html).toContain("Jack found extra work</h2>");
  });

  it("has a close button by default, and none when it isn't dismissible (session expired)", () => {
    expect(dialog()).toContain('aria-label="Close"');
    expect(dialog({ closeLabel: "Close estimate" })).toContain('aria-label="Close estimate"');
    expect(dialog({ dismissible: false })).not.toContain("aria-label=");
  });

  it("reads the description as the dialog's description", () => {
    const html = dialog({ description: "Log in again to carry on." });
    const describedBy = attr(openingTag(html, "dialog"), "aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(html).toContain(`id="${describedBy}"`);
    expect(attr(openingTag(dialog(), "dialog"), "aria-describedby")).toBeUndefined();
  });

  it("has sm, md and lg widths, and an eyebrow and footer when given", () => {
    expect(openingTag(dialog({ size: "lg" }), "dialog")).toMatch(/\blg\b/);
    const html = dialog({ eyebrow: "Needs your OK", footer: <button type="button">Approve</button> });
    expect(html).toContain('<div class="eyebrow">Needs your OK</div>');
    expect(html).toContain('<div class="foot"><button type="button">Approve</button></div>');
  });
});

describe("<ConfirmDialog>", () => {
  const confirm = (tone?: "destructive") =>
    renderToString(
      <ConfirmDialog open title="Cancel this job?" confirmLabel="Cancel job" tone={tone} onConfirm={() => {}} onCancel={() => {}}>
        <p>It hasn’t been paid for yet.</p>
      </ConfirmDialog>,
    );

  it("is an alertdialog with the action named on its main button and “Not now” to back out", () => {
    const html = confirm();
    expect(openingTag(html, "dialog")).toContain('role="alertdialog"');
    expect(html).toMatch(/Not now<\/span>/);
    expect(html).toMatch(/Cancel job<\/span>/);
  });

  it("uses the red outline for destructive actions", () => {
    expect(confirm("destructive")).toMatch(/class="btn destructive/);
    expect(confirm()).not.toMatch(/class="btn destructive/);
  });

  it("shows an error as an alert banner", () => {
    const html = renderToString(
      <ConfirmDialog open title="Send it?" confirmLabel="Send" error="We couldn’t send it." onConfirm={() => {}} onCancel={() => {}} />,
    );
    expect(html).toMatch(/<div class="banner banner-alert" role="alert">/);
    expect(html).toContain("We couldn’t send it.");
  });
});

describe("<Drawer> and <Sheet>", () => {
  it("a drawer slides in from the right (M12)", () => {
    const tag = openingTag(renderToString(<Drawer open title="Your estimate" eyebrow="Sub wiring · TM-1005" />), "dialog");
    expect(tag).toMatch(/class="modal drawer tm-anim-drawer"/);
  });

  it("a sheet rises from the bottom and has a grab handle hidden from screen readers", () => {
    const html = renderToString(<Sheet open title="Filter" />);
    expect(openingTag(html, "dialog")).toMatch(/class="modal sheet tm-anim-sheet"/);
    expect(html).toContain('<div class="grab" aria-hidden="true"></div>');
  });

  it("exits in the spec's times: drawer 200ms, dialog 150ms, sheet 200ms", () => {
    expect(EXIT_MS).toMatchObject({ drawer: 200, dialog: 150, sheet: 200 });
  });
});

describe("<Menu>", () => {
  const menu = (defaultOpen: boolean) =>
    renderToString(
      <Menu
        defaultOpen={defaultOpen}
        header={<b>Sarah Thompson</b>}
        trigger={(props) => <IconButton icon="account_circle" label="Account menu" {...props} />}
      >
        <MenuItem icon="person" href="/account">
          Account
        </MenuItem>
        <MenuItem onSelect={() => {}} disabled>
          Download receipt (after payment)
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon="logout" tone="danger" onSelect={() => {}}>
          Log out
        </MenuItem>
      </Menu>,
    );

  it("gives the trigger the menu button attributes", () => {
    const trigger = openingTag(menu(false), "button");
    expect(trigger).toContain('aria-haspopup="menu"');
    expect(trigger).toContain('aria-expanded="false"');
    expect(trigger).not.toContain("aria-controls");
    expect(menu(false)).not.toContain('role="menu"');
  });

  it("open: a menu named by its trigger, described by its header, with items that arrows move between", () => {
    const html = menu(true);
    const trigger = openingTag(html, "button");
    expect(trigger).toContain('aria-expanded="true"');
    expect(html).toContain(`id="${attr(trigger, "aria-controls")}" role="menu"`);
    expect(html).toContain(`aria-labelledby="${attr(trigger, "id")}"`);
    expect(html).toMatch(/<div id="[^"]+" class="menuHeader"><b>Sarah Thompson<\/b><\/div>/);
    expect(html.match(/role="menuitem" tabindex="-1"/g)).toHaveLength(3);
    expect(html).toContain('<div role="separator" class="menuSeparator"></div>');
    expect(html).toMatch(/class="menuItem menuDanger"/);
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain("tm-anim-suggest"); // M08
  });
});

describe("toasts", () => {
  it("keep an empty live region on the page, so the first toast is read out", () => {
    const html = renderToString(<ToastProvider>page</ToastProvider>);
    expect(html).toBe('page<div class="toastRegion" role="status"></div>');
  });

  it("show the message, a decorative icon, the action and the time-left hairline (M14)", () => {
    const html = renderToString(
      <ToastProvider initial={{ message: "Photo removed.", icon: "delete", action: { label: "Undo", onAction: () => {} } }}>page</ToastProvider>,
    );
    expect(html).toMatch(/<div class="toast tm-anim-toast" data-paused="false">/);
    expect(html).toContain('aria-hidden="true" translate="no">delete</span>');
    expect(html).toContain('<p class="toastMessage">Photo removed.</p>');
    expect(html).toMatch(/class="btn tertiary[^"]*toastAction[^"]*"/);
    expect(html).toContain('<span class="tm-toast-timer" aria-hidden="true"></span>');
  });

  it("need a <ToastProvider>", () => {
    function Orphan() {
      useToast();
      return null;
    }
    expect(() => renderToString(<Orphan />)).toThrow(/ToastProvider/);
  });
});

describe("<Banner>", () => {
  it.each(Object.entries(BANNER_ICONS))("has a %s tone with its own icon (%s)", (tone, icon) => {
    const html = renderToString(<Banner tone={tone as keyof typeof BANNER_ICONS}>Text</Banner>);
    expect(html).toContain(`class="banner banner-${tone}"`);
    expect(html).toContain(`>${icon}</span>`);
  });

  it("puts the title in bold before the text", () => {
    expect(renderToString(<Banner tone="test" title="Test mode.">No real money moves.</Banner>)).toContain(
      '<p class="bannerText"><b>Test mode.</b> <!-- -->No real money moves.</p>',
    );
  });

  it("is only a live region when it appears because something happened", () => {
    expect(openingTag(renderToString(<Banner>Tip</Banner>), "div")).not.toContain("role=");
    expect(openingTag(renderToString(<Banner tone="alert" live>Offline</Banner>), "div")).toContain('role="alert"');
    expect(openingTag(renderToString(<Banner tone="good" live>Sent</Banner>), "div")).toContain('role="status"');
  });

  it("can drop the icon, and shows a Dismiss button only when it can be dismissed", () => {
    expect(renderToString(<Banner icon={null}>Tip</Banner>)).not.toContain("translate");
    expect(renderToString(<Banner>Tip</Banner>)).not.toContain("Dismiss");
    expect(renderToString(<Banner onDismiss={() => {}}>Tip</Banner>)).toContain('aria-label="Dismiss"');
  });
});

describe("overlays.module.css: what if the text is long, the screen small, or the page zoomed to 200%", () => {
  it("never makes an overlay wider than the screen", () => {
    expect(rule(".dialog")).toMatch(/width:\s*min\(520px,/);
    expect(rule(".sm")).toMatch(/width:\s*min\(460px,/);
    expect(rule(".lg")).toMatch(/width:\s*min\(620px,/);
    expect(rule(".drawer")).toMatch(/width:\s*min\(480px, 100%\)/);
    expect(rule(".menu")).toMatch(/max-width:\s*min\(320px,/);
    expect(rule(".toastRegion")).toMatch(/left:\s*var\(--trade-inset-browse\)/);
  });

  it("never makes one taller than the screen: dialogs scroll, drawer and sheet bodies scroll", () => {
    expect(rule(".dialog")).toMatch(/max-height:\s*calc\(100dvh/);
    expect(rule(".dialog")).toMatch(/overflow:\s*auto/);
    expect(rule(".drawer .body")).toMatch(/overflow:\s*auto/);
    expect(rule(".sheet .body")).toMatch(/overflow:\s*auto/);
  });

  it("breaks long words instead of spilling them", () => {
    expect(rule(".body")).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\)/);
    for (const selector of [".title", ".description", ".eyebrow", ".menuLabel", ".toastMessage", ".bannerText"]) {
      expect(rule(selector), selector).toMatch(/overflow-wrap:\s*break-word/);
    }
  });

  it("uses the kit's look: 16px dialog, 22px sheet top corners, Forest toasts, 50% and 55% scrims", () => {
    expect(rule(".dialog")).toMatch(/border-radius:\s*16px/);
    expect(rule(".sheet")).toMatch(/border-radius:\s*var\(--trade-radius-sheet\) var\(--trade-radius-sheet\) 0 0/);
    expect(rule(".toast")).toMatch(/background:\s*var\(--trade-forest\)/);
    expect(rule(".modal::backdrop")).toMatch(/var\(--trade-forest\) 50%/);
    expect(rule(".sheet::backdrop")).toMatch(/var\(--trade-forest\) 55%/);
  });
});

describe("motion.css: the bottom sheet", () => {
  it("rises in 320ms and drops out in 200ms", () => {
    expect(motionCss).toMatch(/\.tm-anim-sheet \{ animation: tm-sheet var\(--trade-dur-slow\) var\(--trade-ease-out\)/);
    expect(motionCss).toMatch(/\.tm-anim-sheet-out \{ animation: tm-sheet-out var\(--trade-dur-base\) var\(--trade-ease-in-out\)/);
  });

  it("is instant with reduced motion", () => {
    const reduced = motionCss.slice(motionCss.indexOf("@media (prefers-reduced-motion: reduce)"));
    for (const selector of [".tm-anim-sheet", ".tm-anim-sheet-out", ".tm-anim-sheet::backdrop", ".tm-anim-sheet-out::backdrop"]) {
      expect(reduced, selector).toContain(`${selector},`);
    }
  });
});

describe("/dev/components/overlays", () => {
  const render = async (params: Record<string, string> = {}) =>
    renderToString(await OverlaysPage({ searchParams: Promise.resolve(params) }));

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is a 404 in production builds", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(render()).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });

  it("has a section for every overlay and the usage example", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const html = await render();
    for (const id of ["dialogs", "drawers", "sheets", "menus", "toasts", "banners", "usage"]) {
      expect(html, id).toContain(`id="${id}"`);
    }
    expect(html).not.toContain("<dialog");
  });

  it("shows each mode's palette, and ignores unknown modes", async () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(await render({ mode: "trade" })).toMatch(/^<div[^>]*data-mode="trade"/);
    expect(await render({ mode: "purple" })).toMatch(/^<div[^>]*data-mode="customer"/);
  });

  it("opens any overlay on load with ?open=, and ignores unknown ids", async () => {
    vi.stubEnv("NODE_ENV", "development");
    for (const id of OPEN_IDS.filter((i) => !i.includes("menu") && !i.includes("toast"))) {
      expect((await render({ open: id })).match(/<dialog/g), id).toHaveLength(1);
    }
    expect(await render({ open: "menu" })).toContain('role="menu"');
    expect(await render({ open: "toast" })).toContain("Photo removed.");
    expect(await render({ open: "nope" })).not.toContain("<dialog");
  });
});
