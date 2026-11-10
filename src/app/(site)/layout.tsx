// Every public page (sitemap A01–A16) sits in the site shell: skip link, header, main, footer (#83).
// The shell reads who is signed in on the server. The role-dispatched root in app/page.tsx selects its own shell.
import type { ReactNode } from "react";

import { SiteShell } from "@/components/site/SiteShell";

export default function SiteLayout({ children }: { children: ReactNode }) {
  return <SiteShell>{children}</SiteShell>;
}
