import type { Metadata, Viewport } from "next";
import { unstable_rethrow } from "next/navigation";
import type { ReactNode } from "react";
import { preload } from "react-dom";

import { FONT_PRELOADS } from "@/lib/fonts";
import { modeForRole, type Role } from "@/lib/mode";
import { getViewer } from "@/server/auth/viewer";

import "@/styles/tokens.css";
import "@/styles/base.css";
import "@/styles/motion.css";

export const metadata: Metadata = {
  title: "Trade Marketplace",
  description: "Post any job free, accept one fair fixed price, and someone local sorts it.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // The visitor's role, read on the server from their Supabase session and their `profiles` row (signed out →
  // customer palette). Because the attribute is in the server-rendered HTML, the first paint already has the
  // right colours: no flash. Log-in and log-out revalidate the layout so it changes with the next page.
  const role = await viewerRole();

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

/**
 * The palette is never worth a broken page: if the profile can't be read (database blip), show the signed-out
 * colours and let the page itself report the problem. Next.js's own signals (e.g. "this page reads cookies, so
 * render it per request") are passed on untouched.
 */
async function viewerRole(): Promise<Role | null> {
  try {
    return (await getViewer())?.role ?? null;
  } catch (error) {
    unstable_rethrow(error);
    console.error("Layout: couldn't read the signed-in visitor; using the signed-out palette.", error);
    return null;
  }
}
