// notFound() on a page in this group (a job they can't see, a missing record) (#109): the 404 inside the group's own
// shell. It never says whether the thing exists.
import type { Metadata } from "next";

import { NotFoundView } from "@/components/errors/NotFoundView";

export const metadata: Metadata = { title: "Page not found", robots: { index: false, follow: false } };

export default function NotFound() {
  return <NotFoundView />;
}
