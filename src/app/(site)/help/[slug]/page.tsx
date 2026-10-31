import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HelpCentre } from "@/components/help/HelpCentre";
import { helpState } from "@/lib/help";
import { loadHelpArticles } from "@/server/help/articles";
import { saveHelpFeedback } from "../actions";
export const dynamicParams = false;
export async function generateStaticParams() { return (await loadHelpArticles()).map(({ slug }) => ({ slug })); }
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const article = (await loadHelpArticles()).find(article => article.slug === slug);
  return { title: article?.title ?? "Help centre", description: article?.blocks[0]?.text };
}
export default async function HelpArticlePage({ params, searchParams }: Props) {
  const [{ slug }, query, articles] = await Promise.all([params, searchParams, loadHelpArticles()]);
  const article = articles.find(article => article.slug === slug);
  if (!article) notFound();
  return <HelpCentre key={`${slug}:${query.state ?? "default"}`} articles={articles} article={article} state={helpState(query.state)} submit={saveHelpFeedback} />;
}
