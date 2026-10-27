// Pretend office data only. The shared guard prevents this preview appearing on a public deployment.
import type { Metadata, Viewport } from "next";

import { currentOfficeLink } from "@/components/office/office-links";
import { guardDevPage } from "@/server/dev-pages";

import { OfficeShellDemo } from "./OfficeShellDemo";

export const metadata: Metadata = { title: "Office shell (dev)", robots: { index: false, follow: false } };
export const viewport: Viewport = { viewportFit: "cover" };
const one = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

export default async function OfficeShellPreview({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  guardDevPage();
  const query = await searchParams;
  const countParam = one(query.counts);
  const counts = countParam === "none" || countParam === "many" ? countParam : "some";
  const atParam = one(query.at);
  const at = atParam?.startsWith("/admin") && currentOfficeLink(atParam) ? atParam : "/admin";
  return <OfficeShellDemo counts={counts} at={at} menuOpen={one(query.menu) === "open"}
    accountOpen={one(query.account) === "open"} testMode={one(query.test) !== "off"} longName={one(query.name) === "long"} />;
}
