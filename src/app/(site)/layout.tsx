// Every public page (sitemap A01–A16) sits in the site shell: skip link, header, main, footer (#83).
// The shell reads who is signed in on the server. Route groups don't change URLs: (site)/page.tsx is still `/`.
import type { ReactNode } from "react";

import { SiteShell } from "@/components/site/SiteShell";

export default function SiteLayout({ children }: { children: ReactNode }) {
  return <SiteShell>{children}</SiteShell>;
}
