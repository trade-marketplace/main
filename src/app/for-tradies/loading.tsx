import { ForTradiesPage } from "@/components/site/ForTradiesPage";
import { SiteFooter } from "@/components/site/SiteFooter";
import { SiteHeader } from "@/components/site/SiteHeader";
import layout from "@/components/site/for-tradies.module.css";

export default function Loading() {
  return <div data-mode="trade" className={layout.frame}><SiteHeader viewer={null} /><main id="main"><ForTradiesPage data={{ status: "loading" }} /></main><SiteFooter /></div>;
}
