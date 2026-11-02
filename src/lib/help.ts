import { z } from "zod";

/** Help topics, in the order the help home shows them (#419). Each article belongs to exactly one. */
export const HELP_TOPICS = ["Getting started", "Customers", "Workers & tradies", "Payments", "Account", "Safety & trust"] as const;
export type HelpTopic = (typeof HELP_TOPICS)[number];
export const HELP_TOPIC_ICONS: Record<HelpTopic, string> = {
  "Getting started": "rocket_launch",
  Customers: "home_repair_service",
  "Workers & tradies": "construction",
  Payments: "payments",
  Account: "account_circle",
  "Safety & trust": "verified_user",
};
/** URL form of a topic, for `/help?topic=…`: "Workers & tradies" → "workers-tradies". */
export function helpTopicSlug(topic: HelpTopic): string {
  return topic.toLocaleLowerCase("en-NZ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
export function helpTopicFromSlug(value: unknown): HelpTopic | null {
  return HELP_TOPICS.find(topic => helpTopicSlug(topic) === value) ?? null;
}
/** A run of text inside a paragraph. `**bold**` in the Markdown becomes a strong span. */
export type HelpSpan = { text: string; strong?: true };
export type HelpBlock = { type: "paragraph" | "heading"; text: string; spans: HelpSpan[] };
export type HelpArticle = { slug: string; title: string; topic: HelpTopic; updated: string; related: string[]; blocks: HelpBlock[]; minutes: number };
export type HelpState = "default" | "search-results" | "no-results" | "loading" | "error" | "helpful-voted" | "not-helpful" | "feedback-error";
export function helpState(value: unknown): HelpState {
  return typeof value === "string" && ["search-results", "no-results", "loading", "error", "helpful-voted", "not-helpful", "feedback-error"].includes(String(value)) ? value as HelpState : "default";
}
export function searchHelp(articles: HelpArticle[], query: string, topic: HelpTopic | "All" = "All") {
  const terms = query.trim().toLocaleLowerCase("en-NZ").split(/\s+/).filter(Boolean);
  const titleMatch = (article: HelpArticle) => terms.length > 0 && terms.every(term => article.title.toLocaleLowerCase("en-NZ").includes(term));
  const matches = articles.filter(article => {
    if (topic !== "All" && article.topic !== topic) return false;
    const text = [article.title, article.topic, ...article.blocks.map(block => block.text)].join(" ").toLocaleLowerCase("en-NZ");
    return terms.every(term => text.includes(term));
  });
  // Articles whose title has every word come first; otherwise the given (topic) order is kept.
  return [...matches.filter(titleMatch), ...matches.filter(article => !titleMatch(article))];
}
export const helpFeedbackInput = z.object({ slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100), helpful: z.boolean(), lookingFor: z.string().trim().max(300).default("") });
export type HelpFeedbackInput = z.infer<typeof helpFeedbackInput>;
export type HelpFeedbackResult = { status: "saved" } | { status: "error" };
