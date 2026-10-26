import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { preload } from "react-dom";

import { FONT_PRELOADS } from "@/lib/fonts";
import { modeForRole, type Role } from "@/lib/mode";

import "@/styles/tokens.css";
import "@/styles/base.css";

export const metadata: Metadata = {
  title: "Trade Marketplace",
  description: "Post any job free, accept one fair fixed price, and someone local sorts it.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // Nobody can sign in yet, so everyone is "signed out" and gets the customer palette.
  // Sign-in (#101) replaces this with the visitor's role, read on the server from their Supabase session.
  // Because the attribute is in the server-rendered HTML, the first paint already has the right colours: no flash.
  const role: Role | null = null;

  // React puts these <link rel="preload"> tags at the top of <head>, before the CSS, so the fonts start downloading
  // straight away instead of waiting for the stylesheet to be parsed.
  for (const font of FONT_PRELOADS) {
    preload(font.href, { as: "font", type: "font/woff2", crossOrigin: "anonymous", fetchPriority: font.fetchPriority });
  }

  return (
    <html lang="en-NZ" data-mode={modeForRole(role)}>
      <body>{children}</body>
    </html>
  );
}
