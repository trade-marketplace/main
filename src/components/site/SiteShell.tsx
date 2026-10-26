// The shared frame for every public page (#83): skip link, header, <main id="main">, footer. Used by
// src/app/(site)/layout.tsx; how to use it: docs/components/site-shell.md.
//
//   <SiteShell>{children}</SiteShell>                     reads who is signed in on the server (getViewer())
//   <SiteShellView viewer={…}>{children}</SiteShellView>  the same frame for a viewer you already have
//
// The public site is always in customer (green) colours, whoever is signed in (sitemap A01–A16): .shell resets
// the mode tokens. A page that needs another palette (For tradies) sets data-mode on its own content.
import { unstable_rethrow } from "next/navigation";
import type { ReactNode } from "react";

import { getViewer } from "@/server/auth/viewer";

import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";
import type { SiteViewer } from "./site-links";
import styles from "./site.module.css";

export const MAIN_ID = "main";

export function SiteShellView({ viewer, children }: { viewer: SiteViewer | null; children: ReactNode }) {
  return (
    <div className={styles.shell}>
      <a href={`#${MAIN_ID}`} className={styles.skip}>
        Skip to content
      </a>
      <SiteHeader viewer={viewer} />
      <main id={MAIN_ID} tabIndex={-1} className={styles.main}>
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}

export async function SiteShell({ children }: { children: ReactNode }) {
  return <SiteShellView viewer={await siteViewer()}>{children}</SiteShellView>;
}

/**
 * The signed-in visitor's first name and role, from the verified session and their profile row. Only those two go
 * to the browser (not the email or user id). If the profile can't be read, the header shows the signed-out links
 * rather than breaking the page, like the root layout's palette.
 */
export async function siteViewer(): Promise<SiteViewer | null> {
  try {
    const viewer = await getViewer();
    return viewer ? { firstName: viewer.firstName, role: viewer.role } : null;
  } catch (error) {
    unstable_rethrow(error);
    console.error("Site header: couldn't read the signed-in visitor; showing the signed-out links.", error);
    return null;
  }
}
