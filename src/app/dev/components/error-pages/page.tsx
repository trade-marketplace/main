// /dev/components/error-pages: the 404 and 500 pages (#109) as they look inside the public site's shell, so the
// 500 can be seen without breaking anything. `?page=500` shows the 500 (the 404 by default); `?ref=off` shows a
// 500 from the browser, which has no reference. The real 404 is any missing address, e.g. /this-page-is-missing.
// Dev only: the shared guard makes it a 404 in production.
import type { Metadata } from "next";

import { NotFoundView } from "@/components/errors/NotFoundView";
import { SiteShellView } from "@/components/site/SiteShell";
import { guardDevPage } from "@/server/dev-pages";

import { ServerErrorPreview } from "./ServerErrorPreview";

export const metadata: Metadata = { title: "Error pages (dev)", robots: { index: false, follow: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ErrorPagesPreview({ searchParams }: { searchParams: SearchParams }) {
  guardDevPage();
  const params = await searchParams;
  const page = params.page === "500" ? "500" : "404";
  return (
    <SiteShellView viewer={null}>
      {page === "404" ? <NotFoundView /> : <ServerErrorPreview withReference={params.ref !== "off"} />}
    </SiteShellView>
  );
}
