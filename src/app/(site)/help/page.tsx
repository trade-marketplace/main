import type { Metadata } from "next";
import { HelpCentre } from "@/components/help/HelpCentre";
import { helpState, helpTopicFromSlug } from "@/lib/help";
import { loadHelpArticles } from "@/server/help/articles";
import { saveHelpFeedback } from "./actions";
export const metadata: Metadata = { title: "Help centre", description: "Answers about posting jobs, prices, payments and doing the work." };
export default async function HelpHome({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  return <HelpCentre key={`${params.state ?? "default"}:${params.q ?? ""}:${params.topic ?? ""}`} articles={await loadHelpArticles()} state={helpState(params.state)} query={typeof params.q === "string" ? params.q.slice(0, 200) : ""} topic={helpTopicFromSlug(params.topic)} submit={saveHelpFeedback} />;
}
