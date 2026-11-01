import { describe, expect, it } from "vitest";
import { recordHelpFeedback } from "@/server/help/feedback";
import { testDatabaseUrl, useTestSchema } from "../support/test-db";
describe.skipIf(!testDatabaseUrl)("help votes in a migrated disposable schema", () => {
  const schema = useTestSchema(import.meta.filename);
  it("persists Yes/No, changes a browser vote without duplicates, and keeps another browser independent", async () => {
    const send = (helpful: boolean, lookingFor = "", key = "a".repeat(64)) => recordHelpFeedback({ slug: "when-do-i-pay", helpful, lookingFor }, key, ["when-do-i-pay"], () => schema.db);
    expect(await send(true)).toEqual({ status: "saved" });
    expect(await send(false, "My receipt")).toEqual({ status: "saved" });
    expect(await schema.db.helpArticleFeedback.findMany()).toMatchObject([{ helpful: false, lookingFor: "My receipt" }]);
    expect(await send(true)).toEqual({ status: "saved" });
    expect(await schema.db.helpArticleFeedback.count()).toBe(1);
    expect(await send(false, "", "b".repeat(64))).toEqual({ status: "saved" });
    expect(await schema.db.helpArticleFeedback.count()).toBe(2);
    expect(await schema.db.helpArticleFeedback.findFirstOrThrow({ where: { voterKey: "a".repeat(64) } })).toMatchObject({ helpful: true, lookingFor: null });
  });
  it("enables RLS without public policies and rejects malformed stored browser keys", async () => {
    const rows = await schema.db.$queryRawUnsafe<{ relrowsecurity: boolean; policies: bigint }[]>(`SELECT c.relrowsecurity, (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies FROM pg_class c JOIN pg_namespace n ON c.relnamespace = n.oid WHERE n.nspname = $1 AND c.relname = 'help_article_feedback'`, schema.name);
    expect(rows).toEqual([{ relrowsecurity: true, policies: 0n }]);
    await expect(schema.db.helpArticleFeedback.create({ data: { articleSlug: "when-do-i-pay", voterKey: "invalid", helpful: true } })).rejects.toThrow();
  });
});
