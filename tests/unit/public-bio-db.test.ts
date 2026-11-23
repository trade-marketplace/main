import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { bioError } from "@/components/account/public-bio-validation";
import { saveBio } from "@/server/workers/public-bio";
import { loadOwnProfilePreview, loadPublicProfile } from "@/server/workers/public-profile";
import { testDatabaseUrl, useTestSchema } from "../support/test-db";

describe("public bio validation", () => {
  it("counts unicode characters after trimming and refuses every control character", () => {
    expect(bioError("  " + "🙂".repeat(300) + " ")).toBeNull();
    expect(bioError("🙂".repeat(301))).toBeTruthy();
    for (const character of ["\n", "\t", "\u007f", "\u0085", "\u0000"]) expect(bioError(character + "bio")).toBeTruthy();
  });
});

describe.skipIf(!testDatabaseUrl)("public bio editor", () => {
  const schema = useTestSchema(import.meta.filename);
  async function person(role: "TRADIE" | "CUSTOMER") {
    const userId = randomUUID(), email = `${userId}@example.test`;
    await schema.db.$executeRaw`INSERT INTO auth.users(id,email) VALUES(${userId}::uuid,${email})`;
    await schema.db.profile.create({ data: { id: userId, email, role, firstName: "Aroha", lastName: "Tui" } });
    if (role === "TRADIE") await schema.db.workerProfile.create({ data: { userId } });
    return { userId, role };
  }
  it("trims, de-duplicates simultaneous saves, publishes only after verification, and clears", async () => {
    const worker = await person("TRADIE");
    const bio = "<b>Electrical work</b>";
    const [first, second] = await Promise.all([saveBio(schema.db, worker, "  " + bio), saveBio(schema.db, worker, bio)]);
    expect(first).toEqual({ ok: true, bio });
    expect(second).toEqual(first);
    const audits = { action: "worker.bio_updated", recordId: worker.userId };
    expect(await schema.db.auditLog.count({ where: audits })).toBe(1);
    expect((await loadOwnProfilePreview(schema.db, worker))?.profile.bio).toBe(bio);
    expect((await loadOwnProfilePreview(schema.db, worker))?.publicPath).toBeNull();
    expect(await loadPublicProfile(schema.db, worker.userId)).toBeNull();
    await schema.db.workerProfile.update({ where: { userId: worker.userId }, data: { verifiedAt: new Date() } });
    expect((await loadPublicProfile(schema.db, worker.userId))?.bio).toBe(bio);
    expect((await loadOwnProfilePreview(schema.db, worker))?.publicPath).toBe(`/tradies/${worker.userId}`);
    expect(await saveBio(schema.db, worker, "   ")).toEqual({ ok: true, bio: "" });
    expect((await loadPublicProfile(schema.db, worker.userId))?.bio).toBeNull();
    expect(await schema.db.auditLog.count({ where: audits })).toBe(2);
  });
  it("refuses invalid text, wrong roles and stale role claims without writing", async () => {
    const worker = await person("TRADIE"), customer = await person("CUSTOMER");
    for (const input of ["a".repeat(301), "a\nb", null, 11]) {
      expect(await saveBio(schema.db, worker, input)).toEqual({ ok: false, error: "invalid" });
    }
    for (const viewer of [customer, { userId: customer.userId, role: "TRADIE" as const }]) {
      expect(await loadOwnProfilePreview(schema.db, viewer)).toBeNull();
      expect(await saveBio(schema.db, viewer, "Bio")).toEqual({ ok: false, error: "forbidden" });
    }
    expect(await schema.db.auditLog.count({ where: { action: "worker.bio_updated", recordId: { in: [worker.userId, customer.userId] } } })).toBe(0);
  });
});
