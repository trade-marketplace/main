// Every signed-in customer and tradie page (sitemap C, D and E) sits in the app shell: skip link, test-mode banner,
// the top nav on a computer, the bottom bar on a phone (#84). Put those pages in this folder; route groups don't
// change URLs, so (app)/dashboard/page.tsx is still /dashboard. The office has its own shell (#85).
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { AppShell } from "@/components/app/AppShell";
import { privateMetadata } from "@/lib/metadata";

export const metadata: Metadata = privateMetadata;

/** Lets the bottom bar reach the bottom edge and pad itself by the phone's safe area (env(safe-area-inset-*)). */
export const viewport: Viewport = { viewportFit: "cover" };

export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
