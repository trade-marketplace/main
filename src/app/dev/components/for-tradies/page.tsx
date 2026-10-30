import { ForTradiesPage } from "@/components/site/ForTradiesPage";
import { SiteFooter } from "@/components/site/SiteFooter";
import { SiteHeader } from "@/components/site/SiteHeader";
import layout from "@/components/site/for-tradies.module.css";
import { guardDevPage } from "@/server/dev-pages";
import { tradieEarnings, type TradieData } from "@/server/for-tradies";

export default async function Preview({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  guardDevPage();
  const { state } = await searchParams;
  // Deliberately isolated sample settings, never a fallback for the public page.
  const data: TradieData = state === "loading" || state === "empty" || state === "error" ? { status: state } : tradieEarnings({ sharedRateCents: 7000, otherRateCents: 3800, sharedMinMinutes: 120, otherMinMinutes: 60, holidayPayBps: 800, onCostBps: 1250, marginBps: 2000, gstBps: 1500 });
  return <div data-mode="trade" className={layout.frame}><SiteHeader viewer={null} currentPath="/for-tradies" /><main id="main"><ForTradiesPage data={data} /></main><SiteFooter /></div>;
}
