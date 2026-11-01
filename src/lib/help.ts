import { z } from "zod";

export const HELP_TOPICS = ["Customers", "Tradies", "Payments", "Account"] as const;
export type HelpTopic = (typeof HELP_TOPICS)[number];
export type HelpBlock = { type: "paragraph" | "heading"; text: string };
export type HelpArticle = { slug: string; title: string; topic: HelpTopic; group: string; updated: string; related: string[]; blocks: HelpBlock[]; minutes: number };
export type HelpState = "default" | "search-results" | "no-results" | "loading" | "error" | "helpful-voted" | "not-helpful" | "feedback-error";
export function helpState(value: unknown): HelpState {
  return typeof value === "string" && ["search-results", "no-results", "loading", "error", "helpful-voted", "not-helpful", "feedback-error"].includes(String(value)) ? value as HelpState : "default";
}
export function searchHelp(articles: HelpArticle[], query: string, topic = "All") {
  const terms = query.trim().toLocaleLowerCase("en-NZ").split(/\s+/).filter(Boolean);
  return articles.filter(article => {
    if (topic !== "All" && article.topic !== topic && article.group !== topic) return false;
    const text = [article.title, article.topic, article.group, ...article.blocks.map(block => block.text)].join(" ").toLocaleLowerCase("en-NZ");
    return terms.every(term => text.includes(term));
  });
}
export const helpFeedbackInput = z.object({ slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100), helpful: z.boolean(), lookingFor: z.string().trim().max(300).default("") });
export type HelpFeedbackInput = z.infer<typeof helpFeedbackInput>;
export type HelpFeedbackResult = { status: "saved" } | { status: "error" };
