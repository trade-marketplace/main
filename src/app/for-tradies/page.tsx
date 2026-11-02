import type { Metadata } from "next";

import { ForTradiesPage } from "@/components/site/ForTradiesPage";
import { StructuredData } from "@/components/site/StructuredData";
import { SiteFooter } from "@/components/site/SiteFooter";
import { SiteHeader } from "@/components/site/SiteHeader";
import { MAIN_ID, siteViewer } from "@/components/site/SiteShell";
import layout from "@/components/site/for-tradies.module.css";
import site from "@/components/site/site.module.css";
import { faqStructuredData } from "@/lib/seo";
import { WORKER_FAQ } from "@/lib/site-faqs";
import { loadTradieData } from "@/server/for-tradies";

export const metadata: Metadata = { title: "For tradies", description: "You do the work. We find the jobs. Local jobs, already priced and paid. No lead fees.", alternates: { canonical: "/for-tradies" } };
// Office rate changes must be read per request, including when a build ran without a database.
export const dynamic = "force-dynamic";

export default async function ForTradies() {
  const [viewer, data] = await Promise.all([siteViewer(), loadTradieData()]);
  return <div data-mode="trade" className={layout.frame}><StructuredData data={faqStructuredData(WORKER_FAQ)} /><a className={site.skip} href={`#${MAIN_ID}`}>Skip to content</a><SiteHeader viewer={viewer} /><main id={MAIN_ID} className={site.main} tabIndex={-1}><ForTradiesPage data={data} /></main><SiteFooter /></div>;
}
