import "server-only";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { cache } from "react";
import { z } from "zod";
import { HELP_TOPICS, type HelpArticle, type HelpSpan } from "@/lib/help";

/**
 * `confirm` holds an article back until a founder has confirmed it (#419: lines marked "(confirm)"). Say who and what,
 * e.g. "William: refund timing". Held articles are never served, searched or linked; delete the key to publish.
 */
const metadata = z.object({ title: z.string().min(1), topic: z.enum(HELP_TOPICS), updated: z.iso.date(), related: z.array(z.string()), confirm: z.string().min(1).optional() }).strict();
/** The help home lists each topic's articles in this order; anything not listed follows, by title. */
export const HELP_ARTICLE_ORDER = [
  "what-is-trade-marketplace", "where-do-you-work", "do-i-need-an-account", "is-it-free",
  "posting-a-job", "how-is-my-price-worked-out", "why-is-my-price-different", "accepting-or-saying-no", "who-will-do-my-job", "on-the-day", "extra-work", "checking-and-signing-off", "electrical-work-and-your-coc", "leaving-a-review", "cancelling-a-job", "something-is-not-right",
  "who-can-work", "joining", "tradie-licences", "what-will-i-earn", "how-and-when-do-i-get-paid", "materials", "extra-work-on-a-job", "running-late", "uploading-your-coc",
  "when-do-i-pay", "how-do-i-pay", "receipts-and-gst", "refunds",
  "reset-your-password", "change-your-details", "notifications", "delete-your-account",
  "how-do-you-check-workers", "your-details", "paying-safely",
];
function spans(text: string): HelpSpan[] {
  return text.split(/(\*\*[^*]+\*\*)/).filter(Boolean).map(part => part.startsWith("**") && part.endsWith("**") ? { text: part.slice(2, -2), strong: true as const } : { text: part });
}
export type ParsedHelpArticle = HelpArticle & { confirm?: string };
/** Repo-owned Markdown only. Render text as React nodes; never execute HTML or user-supplied Markdown. */
export function parseHelpArticle(slug: string, source: string): ParsedHelpArticle {
  const match = /^<!-- (.+) -->\s*([\s\S]*)$/.exec(source);
  if (!match) throw new Error(`Missing help metadata: ${slug}`);
  const meta = metadata.parse(JSON.parse(match[1]));
  const blocks = match[2].trim().split(/\n\s*\n/).map(raw => {
    const heading = raw.startsWith("## ");
    const parts = spans(raw.replace(/^## /, "").replace(/\n/g, " "));
    return { type: heading ? "heading" as const : "paragraph" as const, text: parts.map(part => part.text).join(""), spans: parts };
  });
  const words = blocks.reduce((total, block) => total + block.text.split(/\s+/).length, 0);
  return { ...meta, slug, blocks, minutes: Math.max(1, Math.ceil(words / 200)) };
}
function rank(article: HelpArticle) {
  const index = HELP_ARTICLE_ORDER.indexOf(article.slug);
  return [HELP_TOPICS.indexOf(article.topic), index < 0 ? HELP_ARTICLE_ORDER.length : index] as const;
}
export function sortHelpArticles<T extends HelpArticle>(articles: T[]): T[] {
  return [...articles].sort((a, b) => {
    const [topicA, orderA] = rank(a), [topicB, orderB] = rank(b);
    return topicA - topicB || orderA - orderB || a.title.localeCompare(b.title, "en-NZ");
  });
}
/** Every article file, held ones included. Only tests and `loadHelpArticles` should need this. */
export const loadAllHelpArticles = cache(async (): Promise<ParsedHelpArticle[]> => {
  const directory = path.join(process.cwd(), "content/help");
  const files = (await readdir(directory)).filter(file => /^[a-z0-9-]+\.md$/.test(file));
  return sortHelpArticles(await Promise.all(files.map(async file => parseHelpArticle(file.slice(0, -3), await readFile(path.join(directory, file), "utf8")))));
});
/** The published help centre: held (`confirm`) articles are left out, and so are any related links to them. */
export const loadHelpArticles = cache(async (): Promise<HelpArticle[]> => {
  const published = (await loadAllHelpArticles()).filter(article => !article.confirm);
  const slugs = new Set(published.map(article => article.slug));
  return published.map(({ slug, title, topic, updated, related, blocks, minutes }) => ({ slug, title, topic, updated, blocks, minutes, related: related.filter(item => slugs.has(item)) }));
});
