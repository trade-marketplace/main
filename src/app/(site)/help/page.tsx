import type { Metadata } from "next";
import { HelpCentre } from "@/components/help/HelpCentre";
import { helpState } from "@/lib/help";
import { loadHelpArticles } from "@/server/help/articles";
import { saveHelpFeedback } from "./actions";
export const metadata: Metadata = { title: "Help centre", description: "Help with posting a job, payments, your account and working with Trade Marketplace." };
export default async function HelpHome({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  return <HelpCentre key={`${params.state ?? "default"}:${params.q ?? ""}`} articles={await loadHelpArticles()} state={helpState(params.state)} query={typeof params.q === "string" ? params.q.slice(0, 200) : ""} submit={saveHelpFeedback} />;
}
