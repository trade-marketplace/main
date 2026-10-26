// What if the icon font fails to load? The icon's ligature text is then shown in a plain font, so every icon must
// carry its meaning another way: an aria-label (stands alone) or visible text next to it (decorative).
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Icon } from "@/components/Icon";

describe("Icon", () => {
  it("gives a standalone icon role=img and its label, so it still means something without the font", () => {
    const html = renderToString(<Icon name="notifications" label="Notifications" />);
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Notifications"');
    expect(html).not.toContain("aria-hidden");
  });

  it("hides a decorative icon from screen readers (its text label sits next to it)", () => {
    const html = renderToString(
      <span>
        <Icon name="check_circle" decorative /> Free to post
      </span>,
    );
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain("role=");
    expect(html).toContain("Free to post");
  });

  it("renders the ligature name, which is what shows if the font fails", () => {
    expect(renderToString(<Icon name="search" label="Search" />)).toContain(">search</span>");
  });

  it("keeps browser translation from rewriting the ligature name", () => {
    expect(renderToString(<Icon name="home" label="Home" />)).toContain('translate="no"');
  });

  it("refuses (at compile time) an icon with no meaning", () => {
    // @ts-expect-error: an icon needs either a label or `decorative`.
    const html = renderToString(<Icon name="bolt" />);
    // Even if someone forces it past TypeScript, it is hidden rather than read out as "bolt".
    expect(html).toContain('aria-hidden="true"');
  });
});

describe("icons in app code", () => {
  it("only use the Material Symbols font through <Icon>", () => {
    const src = fileURLToPath(new URL("../../src/", import.meta.url));
    const offenders = readdirSync(src, { recursive: true, encoding: "utf8" })
      .filter((f) => /\.(tsx?|css)$/.test(f))
      .map((f) => f.split(path.sep).join("/"))
      .filter((f) => !["components/Icon.tsx", "components/Icon.module.css", "styles/tokens.css"].includes(f))
      .filter((f) => !f.startsWith("app/dev/"))
      // A font-family use, i.e. the name in quotes (a mention in a comment is fine).
      .filter((f) => /['"]Material Symbols Rounded['"]/.test(readFileSync(path.join(src, f), "utf8")));
    expect(offenders).toEqual([]);
  });
});
