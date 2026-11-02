import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { saveProfile } from "@/server/account/profile";
import { prismaProfileStore } from "@/server/account/profile-store";

import { testDatabaseUrl, useTestSchema } from "../support/test-db";

vi.mock("@/server/db", () => ({ getDb: vi.fn() }));

// The profile save against the real `profiles` table (a throwaway Postgres, never Supabase).
describe.skipIf(!testDatabaseUrl)("profile save in Postgres", () => {
  const schema = useTestSchema(import.meta.filename);

  async function person(email: string, first: string) {
    const id = randomUUID();
    await schema.db.$executeRawUnsafe(`INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`, id, email);
    await schema.db.profile.create({ data: { id, email, role: "CUSTOMER", firstName: first, lastName: "Before", phone: "+64215550100" } });
    return id;
  }

  it("changes only the signed-in person's name and mobile, never another row or the email", async () => {
    const mine = await person(`${randomUUID()}@example.nz`, "Mine");
    const theirs = await person(`${randomUUID()}@example.nz`, "Theirs");
    const before = await schema.db.profile.findUniqueOrThrow({ where: { id: mine } });
    const store = prismaProfileStore(() => schema.db);

    const result = await saveProfile(store, mine, { name: "Sarah Jane Thompson", phone: "021 555 0192" });

    expect(result).toEqual({ ok: true, name: "Sarah Jane Thompson", phone: "021 555 0192" });
    expect(await schema.db.profile.findUniqueOrThrow({ where: { id: mine } })).toMatchObject({
      firstName: "Sarah", lastName: "Jane Thompson", phone: "+64215550192", email: before.email, role: "CUSTOMER", emailVerifiedAt: before.emailVerifiedAt,
    });
    expect(await schema.db.profile.findUniqueOrThrow({ where: { id: theirs } })).toMatchObject({ firstName: "Theirs", lastName: "Before", phone: "+64215550100" });
  });

  it("reads back the saved values for the page", async () => {
    const id = await person(`${randomUUID()}@example.nz`, "Sam");
    expect(await prismaProfileStore(() => schema.db).find(id)).toMatchObject({ firstName: "Sam", lastName: "Before", phone: "+64215550100", avatarPath: null });
  });

  it("says unavailable, not a crash, when the row is gone", async () => {
    const result = await saveProfile(prismaProfileStore(() => schema.db), randomUUID(), { name: "Sam", phone: "021 555 0192" });
    expect(result).toEqual({ ok: false, error: "unavailable" });
  });
});
