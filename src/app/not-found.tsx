// Any address that doesn't exist, and notFound() anywhere outside a route group with its own (#109): the 404 in
// the public site's header and footer. The status is still 404.
import type { Metadata } from "next";

import { NotFoundView } from "@/components/errors/NotFoundView";
import { SiteShell } from "@/components/site/SiteShell";

export const metadata: Metadata = { title: "Page not found", robots: { index: false, follow: false } };

export default function NotFound() {
  return (
    <SiteShell>
      <NotFoundView />
    </SiteShell>
  );
}
