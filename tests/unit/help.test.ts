import { describe, expect, it, vi } from "vitest";
import { HELP_TOPICS, helpState, helpTopicFromSlug, helpTopicSlug, searchHelp } from "@/lib/help";
import { HELP_ARTICLE_ORDER, loadAllHelpArticles, loadHelpArticles, parseHelpArticle } from "@/server/help/articles";
import { recordHelpFeedback } from "@/server/help/feedback";
import type { PrismaClient } from "@/generated/prisma/client";
const voter = "a".repeat(64);
const input = { slug: "when-do-i-pay", helpful: true, lookingFor: "" };
function store(upsert = vi.fn().mockResolvedValue({})) { return { upsert, db: { helpArticleFeedback: { upsert } } as unknown as Pick<PrismaClient, "helpArticleFeedback"> }; }
describe("repo-owned help articles", () => {
  it("loads every topic, in order, and resolves every related link to a published article", async () => {
    const articles = await loadHelpArticles();
    expect([...new Set(articles.map(a => a.topic))]).toEqual([...HELP_TOPICS]);
    expect(articles.map(a => HELP_TOPICS.indexOf(a.topic))).toEqual(articles.map(a => HELP_TOPICS.indexOf(a.topic)).toSorted((a, b) => a - b));
    for (const article of articles) {
      expect(article.blocks.length).toBeGreaterThan(0); expect(article.minutes).toBeGreaterThan(0);
      expect(article.related.length).toBeGreaterThan(0);
      for (const related of article.related) { expect(related).not.toBe(article.slug); expect(articles.some(a => a.slug === related)).toBe(true); }
    }
  });
  it("has every #419 article, each listed in the home order", async () => {
    const all = await loadAllHelpArticles();
    expect(all.map(a => a.slug).toSorted()).toEqual([...HELP_ARTICLE_ORDER].toSorted());
    expect(all).toHaveLength(36);
  });
  it("holds back articles that still need a founder to confirm them, and never links to them", async () => {
    const held = (await loadAllHelpArticles()).filter(a => a.confirm).map(a => a.slug);
    expect(held.toSorted()).toEqual(["delete-your-account", "how-and-when-do-i-get-paid", "materials", "refunds", "what-will-i-earn"]);
    const published = await loadHelpArticles();
    for (const slug of held) expect(published.some(a => a.slug === slug || a.related.includes(slug))).toBe(false);
    expect(searchHelp(published, "refunds usually show up")).toEqual([]);
    for (const article of published) expect(article).not.toHaveProperty("confirm");
  });
  it("keeps the payment explanation and says workers, not tradies, where it means everyone", async () => {
    const article = (await loadHelpArticles()).find(a => a.slug === input.slug)!;
    expect(article.topic).toBe("Payments");
    expect(article.blocks.map(b => b.text)).toEqual([
      "You pay when you accept your price, before anyone turns up. That locks in your booking.",
      "Your worker gets paid after you’ve checked the job and said it’s all good, or 48 hours after they finish if we don’t hear from you.",
      "Extra work? You’ll see photos and the cost first, and you only pay for it if you say yes.",
    ]);
  });
  it("follows the copy rules: no paperwork promise, Invercargill only where the area matters", async () => {
    const articles = await loadAllHelpArticles();
    const text = articles.flatMap(a => [a.title, ...a.blocks.map(b => b.text)]).join("\n");
    expect(text).not.toMatch(/paperwork|estimate[ds]? (?:of|range)|average|margin|\(confirm/i);
    expect(articles.filter(a => a.blocks.some(b => b.text.includes("Invercargill"))).map(a => a.slug)).toEqual(["where-do-you-work"]);
  });
  it("renders **bold** as a strong span and keeps plain text for search and metadata", () => {
    const article = parseHelpArticle("bold", '<!-- {"title":"Bold","topic":"Account","updated":"2026-11-02","related":[]} -->\n\nChoose **Forgot password?** now.');
    expect(article.blocks[0]).toEqual({ type: "paragraph", text: "Choose Forgot password? now.", spans: [{ text: "Choose " }, { text: "Forgot password?", strong: true }, { text: " now." }] });
  });
  it("searches all words case-insensitively across Markdown and filters topics", async () => {
    const articles = await loadHelpArticles();
    expect(searchHelp(articles, "  PHOTOS extra ").some(a => a.slug === input.slug)).toBe(true);
    expect(searchHelp(articles, "", "Account").map(a => a.slug)).toEqual(["reset-your-password", "change-your-details", "notifications"]);
    expect(searchHelp(articles, "", "Safety & trust").every(a => a.topic === "Safety & trust")).toBe(true);
    expect(searchHelp(articles, "unmatched search")).toEqual([]);
  });
  it("puts articles whose title has every word first", async () => {
    const articles = await loadHelpArticles();
    expect(searchHelp(articles, "when do I")[0].slug).toBe("when-do-i-pay");
    expect(searchHelp(articles, "cancel")[0].slug).toBe("cancelling-a-job");
  });
  it("maps topics to and from their URL form", () => {
    for (const topic of HELP_TOPICS) expect(helpTopicFromSlug(helpTopicSlug(topic))).toBe(topic);
    expect(helpTopicSlug("Workers & tradies")).toBe("workers-tradies");
    expect(helpTopicFromSlug("nope")).toBeNull(); expect(helpTopicFromSlug(["customers"])).toBeNull();
  });
  it("rejects missing/invalid metadata rather than serving malformed articles", () => {
    expect(() => parseHelpArticle("bad", "# Bad")).toThrow();
    expect(() => parseHelpArticle("bad", '<!-- {"title":"Bad"} -->\nText')).toThrow();
    expect(() => parseHelpArticle("bad", '<!-- {"title":"Bad","topic":"Tradies","updated":"2026-11-02","related":[]} -->\nText')).toThrow();
    expect(() => parseHelpArticle("bad", '<!-- {"title":"Bad","topic":"Account","updated":"2026-11-02","related":[],"group":"Old"} -->\nText')).toThrow();
  });
  it("recognizes only the explicit reviewer states", () => { expect(helpState("not-helpful")).toBe("not-helpful"); expect(helpState(["error"])).toBe("default"); expect(helpState("invented")).toBe("default"); });
});
describe("persisting helpful votes", () => {
  it("atomically records one vote per article and anonymous browser key", async () => {
    const { upsert, db } = store();
    expect(await recordHelpFeedback(input, voter, [input.slug], () => db)).toEqual({ status: "saved" });
    expect(upsert).toHaveBeenCalledExactlyOnceWith({ where: { articleSlug_voterKey: { articleSlug: input.slug, voterKey: voter } }, create: { articleSlug: input.slug, voterKey: voter, helpful: true, lookingFor: null }, update: { helpful: true, lookingFor: null } });
  });
  it("records No without a note, accepts the optional one-line note, and discards notes on Yes", async () => {
    const { db, upsert } = store();
    for (const note of ["", "  Find my invoice  "]) expect(await recordHelpFeedback({ ...input, helpful: false, lookingFor: note }, voter, [input.slug], () => db)).toEqual({ status: "saved" });
    expect(upsert.mock.calls[1][0].update).toEqual({ helpful: false, lookingFor: "Find my invoice" });
    await recordHelpFeedback({ ...input, lookingFor: "discard me" }, voter, [input.slug], () => db);
    expect(upsert.mock.calls[2][0].update.lookingFor).toBeNull();
  });
  it("validates before opening the database and never accepts an unknown article", async () => {
    for (const bad of [{ ...input, slug: "../secret" }, { ...input, slug: "not-an-article" }, { ...input, helpful: "yes" }, { ...input, lookingFor: "x".repeat(301) }]) {
      const database = vi.fn(); expect(await recordHelpFeedback(bad, voter, [input.slug], database)).toEqual({ status: "error" }); expect(database).not.toHaveBeenCalled();
    }
    expect(await recordHelpFeedback(input, "not-a-digest", [input.slug], () => store().db)).toEqual({ status: "error" });
  });
  it("does not report success without a database or when saving fails", async () => {
    expect(await recordHelpFeedback(input, voter, [input.slug], () => null)).toEqual({ status: "error" });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await recordHelpFeedback(input, voter, [input.slug], () => store(vi.fn().mockRejectedValue(new Error("private note"))).db)).toEqual({ status: "error" });
    expect(log).toHaveBeenCalledWith("Help feedback could not be saved."); log.mockRestore();
  });
});
