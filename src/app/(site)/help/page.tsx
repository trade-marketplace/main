import type { Metadata } from "next";
import { siteViewer } from "@/components/site/SiteShell";
import { HelpCentre } from "@/components/help/HelpCentre";
import { helpState, helpTopicFromSlug } from "@/lib/help";
import { loadHelpArticles } from "@/server/help/articles";
import { saveHelpFeedback } from "./actions";
export const metadata: Metadata = { title: "Help centre", description: "Answers about posting jobs, prices, payments and doing the work.", alternates: { canonical: "/help" } };
export default async function HelpHome({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const viewer = await siteViewer();
  return <HelpCentre signedIn={Boolean(viewer)} officeSupport={viewer?.role === "ADMIN"} key={`${params.state ?? "default"}:${params.q ?? ""}:${params.topic ?? ""}`} articles={await loadHelpArticles()} state={helpState(params.state)} query={typeof params.q === "string" ? params.q.slice(0, 200) : ""} topic={helpTopicFromSlug(params.topic)} submit={saveHelpFeedback} />;
}
