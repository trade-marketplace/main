import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { ImageResponse } from "next/og";
import { cloneElement, type ReactElement, type SVGProps } from "react";

import { BoltMark } from "@/components/BoltMark";
import { tokenColour } from "@/server/brand-colours";

// The social share image (Open Graph + Twitter card), 1200 × 630 (#218, mockup `w-meta`, "Social share image").
// One per public page type, in that page's mode: customer pages Lime, tradie pages Amber. Each page type's
// `opengraph-image.tsx` calls `shareImage()` with its own words; service pages (#A04) can pass the trade name.
// Private pages have none (`privateMetadata` in src/lib/metadata.ts).
//
// Drawn by next/og (Satori) at build time. Satori can't read WOFF2 or variable fonts, so it uses static TTF
// instances of Roboto Flex at the tokens' Display and UI settings (scripts/brand/og-fonts.py).
// The layout is the mockup's 600 × 315 preview at 2×.

export const SHARE_IMAGE_SIZE = { width: 1200, height: 630 } as const;
export const SHARE_IMAGE_TYPE = "image/png";

export type ShareImageMode = "customer" | "trade";

export type ShareImageContent = {
  mode: ShareImageMode;
  /** The big Display line, one string per line as the page hero breaks it. */
  headline: readonly string[];
  /** One plain line under it, usually "[promise] · trademarketplace.nz". */
  subline: string;
  /** Artwork bottom right. The customer card has the van; leave it out for just the bolt. */
  art?: "van";
};

// Literal paths, so the build only traces these files (not the whole project).
const DISPLAY_FONT = path.join(process.cwd(), "public/fonts/roboto-flex/RobotoFlex-Display.ttf");
const UI_FONT = path.join(process.cwd(), "public/fonts/roboto-flex/RobotoFlex-UI.ttf");
const WORDMARK = path.join(process.cwd(), "docs/design/brand/wordmark.svg");
const VAN = path.join(process.cwd(), "public/images/van.png");

/** docs/design/brand/wordmark.svg with its colours swapped for the mode's tokens (bolt = signature, words = Paper). */
async function wordmark(signature: string, words: string): Promise<string> {
  const svg = await readFile(WORDMARK, "utf8");
  const paper = tokenColour("paper").toLowerCase();
  const lime = tokenColour("lime").toLowerCase();
  const recoloured = svg.replace(/fill="(#[0-9a-fA-F]{3,8})"/g, (whole, hex: string) => {
    if (hex.toLowerCase() === lime) return `fill="${signature}"`;
    if (hex.toLowerCase() === paper) return `fill="${words}"`;
    return whole;
  });
  return `data:image/svg+xml;base64,${Buffer.from(recoloured).toString("base64")}`;
}

/** The big brand-device bolt (the same art as `<BoltMark variant="hero" />`), coloured for Satori. */
function heroBolt(fill: string, width: number): ReactElement {
  const bolt = BoltMark({ variant: "hero" }) as ReactElement<SVGProps<SVGSVGElement>>;
  return cloneElement(bolt, { fill, width, height: Math.round((width * 694) / 419) });
}

export async function shareImage({ mode, headline, subline, art }: ShareImageContent): Promise<ImageResponse> {
  const forest = tokenColour("forest");
  const signature = tokenColour("signature", mode);
  const onDark = tokenColour("text-on-dark");

  const [display, ui, logo, van] = await Promise.all([
    readFile(DISPLAY_FONT),
    readFile(UI_FONT),
    wordmark(signature, tokenColour("paper")),
    art === "van" ? readFile(VAN).then((png) => `data:image/png;base64,${png.toString("base64")}`) : null,
  ]);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          position: "relative",
          overflow: "hidden",
          background: forest,
          color: onDark,
          padding: "60px 68px",
          fontFamily: "Trade UI",
        }}
      >
        {/* The brand device: the signature bolt at 20%, off the top right edge (.tm-bolt). */}
        <div style={{ position: "absolute", left: 660, top: -160, opacity: 0.2, display: "flex" }}>
          {heroBolt(signature, 800)}
        </div>

        {/* eslint-disable-next-line @next/next/no-img-element -- Satori draws <img>, not next/image */}
        <img src={logo} width={249} height={61} alt="" style={{ position: "relative" }} />

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            marginTop: 80,
            position: "relative",
            fontFamily: "Trade Display",
            fontWeight: 900,
            fontSize: 96,
            lineHeight: 1.05,
          }}
        >
          {headline.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </div>

        <div style={{ marginTop: 20, fontSize: 32, opacity: 0.8, position: "relative" }}>{subline}</div>

        {van ? (
          // eslint-disable-next-line @next/next/no-img-element -- Satori draws <img>, not next/image
          <img src={van} width={560} height={392} alt="" style={{ position: "absolute", right: -40, bottom: 20 }} />
        ) : null}
      </div>
    ),
    {
      ...SHARE_IMAGE_SIZE,
      fonts: [
        { name: "Trade Display", data: display, weight: 900, style: "normal" },
        { name: "Trade UI", data: ui, weight: 400, style: "normal" },
      ],
    },
  );
}
