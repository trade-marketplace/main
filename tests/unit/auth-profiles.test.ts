import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { ensureProfile, logIn, signUp, type AuthClient, type AuthUserLike } from "@/server/auth/account";
import { prismaProfiles } from "@/server/auth/profiles";

import { testDatabaseUrl, useTestSchema } from "../support/test-db";

// Sign-up and log-in against the real `profiles` table (#101): the profile is created on the server with Prisma
// right after Supabase creates the user. Supabase Auth itself is faked; its `auth.users` row is the stand-in.

describe.skipIf(!testDatabaseUrl)("profiles for sign-in", () => {
  const schema = useTestSchema(import.meta.filename);
  const profiles = () => prismaProfiles(() => schema.db);

  /** What Supabase does on sign-up: creates the auth user. */
  async function authUser(email: string, overrides: Partial<AuthUserLike> = {}): Promise<AuthUserLike> {
    const id = randomUUID();
    await schema.db.$executeRawUnsafe(`INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`, id, email);
    return { id, email, email_confirmed_at: null, user_metadata: {}, identities: [{}], ...overrides };
  }

  function fakeAuth(user: AuthUserLike): AuthClient {
    return {
      signUp: async () => ({ data: { user, session: null }, error: null }),
      signInWithPassword: async () => ({ data: { user, session: {} }, error: null }),
      signOut: async () => ({ error: null }),
    };
  }

  it("creates the profile with the role they chose, email lowercased", async () => {
    const email = `${randomUUID()}@Example.NZ`;
    const user = await authUser(email.toLowerCase());
    const result = await signUp(
      { auth: fakeAuth(user), profiles: profiles() },
      { email, password: "korimako-gumboot-41", firstName: "Aroha", lastName: "Ngata", role: "TRADIE", phone: "0215550192", terms: true },
    );
    expect(result).toMatchObject({ ok: true, status: "check-email" });
    const row = await schema.db.profile.findUniqueOrThrow({ where: { id: user.id } });
    expect(row).toMatchObject({ email: email.toLowerCase(), role: "TRADIE", firstName: "Aroha", lastName: "Ngata", phone: "+64215550192" });
  });

  it("can't create a profile for someone Supabase doesn't know", async () => {
    const store = profiles();
    await expect(
      store.create({
        id: randomUUID(),
        email: `${randomUUID()}@example.nz`,
        role: "CUSTOMER",
        firstName: "Ghost",
        lastName: null,
        emailVerifiedAt: null,
      }),
    ).rejects.toThrow(/Foreign key constraint/);
  });

  it("log-in creates a missing profile and records when the email was confirmed", async () => {
    const user = await authUser(`${randomUUID()}@example.nz`, {
      email_confirmed_at: "2026-10-26T01:00:00Z",
      user_metadata: { first_name: "Sam", role: "CUSTOMER" },
    });
    const result = await logIn({ auth: fakeAuth(user), profiles: profiles() }, { email: user.email!, password: "x" });
    expect(result).toEqual({ ok: true, role: "CUSTOMER", redirectTo: "/" });
    const row = await schema.db.profile.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.emailVerifiedAt).toEqual(new Date("2026-10-26T01:00:00Z"));
  });

  it("recognises Prisma's real duplicate error when two requests create the same profile", async () => {
    const user = await authUser(`${randomUUID()}@example.nz`, { user_metadata: { first_name: "Sam" } });
    const store = profiles();
    // The other request wins: the profile exists by the time this one tries to create it.
    await ensureProfile(store, user);
    // This one looked before the other had saved, so its create really fails with P2002, and ensureProfile turns
    // that into the existing row instead of an error.
    let firstFind = true;
    const raceOnce = {
      ...store,
      find: async (id: string) => {
        if (firstFind) {
          firstFind = false;
          return null;
        }
        return store.find(id);
      },
    };
    await expect(ensureProfile(raceOnce, user)).resolves.toMatchObject({ id: user.id, firstName: "Sam" });
  });
});
