import { describe, expect, it, vi } from "vitest";
import { helpState, searchHelp } from "@/lib/help";
import { loadHelpArticles, parseHelpArticle } from "@/server/help/articles";
import { recordHelpFeedback } from "@/server/help/feedback";
import type { PrismaClient } from "@/generated/prisma/client";
const voter = "a".repeat(64);
const input = { slug: "when-do-i-pay", helpful: true, lookingFor: "" };
function store(upsert = vi.fn().mockResolvedValue({})) { return { upsert, db: { helpArticleFeedback: { upsert } } as unknown as Pick<PrismaClient, "helpArticleFeedback"> }; }
describe("repo-owned help articles", () => {
  it("loads every topic and resolves every related link to a real article", async () => {
    const articles = await loadHelpArticles();
    expect(new Set(articles.map(a => a.topic))).toEqual(new Set(["Customers", "Payments", "Tradies", "Account"]));
    for (const article of articles) { expect(article.blocks.length).toBeGreaterThan(0); expect(article.minutes).toBeGreaterThan(0); for (const related of article.related) expect(articles.some(a => a.slug === related)).toBe(true); }
  });
  it("keeps the designed payment explanation and extra-work section intact", async () => {
    const article = (await loadHelpArticles()).find(a => a.slug === input.slug)!;
    expect(article.blocks[0].text).toBe("You pay when you accept your price, before anyone turns up. That locks in your booking.");
    expect(article.blocks[1].text).toContain("48 hours after they finish");
    expect(article.blocks[2]).toEqual({ type: "heading", text: "What if there’s extra work?" });
  });
  it("searches all words case-insensitively across Markdown and filters topics", async () => {
    const articles = await loadHelpArticles();
    expect(searchHelp(articles, "  PHOTOS extra ").some(a => a.slug === input.slug)).toBe(true);
    expect(searchHelp(articles, "", "Account").map(a => a.slug)).toEqual(["reset-your-password"]);
    expect(searchHelp(articles, "unmatched search")).toEqual([]);
  });
  it("rejects missing/invalid metadata rather than serving malformed articles", () => {
    expect(() => parseHelpArticle("bad", "# Bad")).toThrow();
    expect(() => parseHelpArticle("bad", '<!-- {"title":"Bad"} -->\nText')).toThrow();
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
