import type { MetadataRoute } from "next";

import { SITE_NAME } from "@/lib/metadata";
import { tokenColour } from "@/server/brand-colours";

// The web app manifest, served at /manifest.webmanifest (#218, mockup `w-meta`: name, short_name "TradeMkt",
// theme Forest, background Paper, standalone). Icons come from scripts/brand/icons.mjs.
// The "Add to home screen" card is the "Install as app (PWA)" task (G08), not this file.

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: SITE_NAME,
    short_name: "TradeMkt",
    description: "Post any job free, accept one fair fixed price, and someone local sorts it.",
    lang: "en-NZ",
    start_url: "/",
    scope: "/",
    display: "standalone",
    theme_color: tokenColour("forest"),
    background_color: tokenColour("paper"),
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
