import "server-only";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { cache } from "react";
import { z } from "zod";
import { HELP_TOPICS, type HelpArticle } from "@/lib/help";

const metadata = z.object({ title: z.string().min(1), topic: z.enum(HELP_TOPICS), group: z.string(), updated: z.iso.date(), related: z.array(z.string()) });
/** Repo-owned Markdown only. Render text as React nodes; never execute HTML or user-supplied Markdown. */
export function parseHelpArticle(slug: string, source: string): HelpArticle {
  const match = /^<!-- (.+) -->\s*([\s\S]*)$/.exec(source);
  if (!match) throw new Error(`Missing help metadata: ${slug}`);
  const meta = metadata.parse(JSON.parse(match[1]));
  const blocks = match[2].trim().split(/\n\s*\n/).map(text => ({ type: text.startsWith("## ") ? "heading" as const : "paragraph" as const, text: text.replace(/^## /, "").replace(/\n/g, " ") }));
  const words = blocks.reduce((total, block) => total + block.text.split(/\s+/).length, 0);
  return { ...meta, slug, blocks, minutes: Math.max(1, Math.ceil(words / 200)) };
}
export const loadHelpArticles = cache(async (): Promise<HelpArticle[]> => {
  const directory = path.join(process.cwd(), "content/help");
  const files = (await readdir(directory)).filter(file => /^[a-z0-9-]+\.md$/.test(file));
  const articles = await Promise.all(files.map(async file => parseHelpArticle(file.slice(0, -3), await readFile(path.join(directory, file), "utf8"))));
  const order = ["how-is-my-price-worked-out", "cancelling-a-job", "extra-work", "when-do-i-pay", "posting-a-job"];
  return articles.sort((a, b) => (order.includes(a.slug) ? order.indexOf(a.slug) : 100) - (order.includes(b.slug) ? order.indexOf(b.slug) : 100));
});
