import { randomUUID } from "node:crypto";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { officeUserEmail, officeUsers } from "@/server/office/users";

import { testDatabaseUrl, useTestSchema } from "../support/test-db";
import { parseOfficeUserCommand, runOfficeUserCommand } from "../../scripts/office-user";

describe("office-user command", () => {
  it("normalizes email and accepts only explicit commands", () => {
    expect(officeUserEmail("  Sam@Example.nz ")).toBe("sam@example.nz");
    expect(parseOfficeUserCommand(["add", "Sam@Example.nz", "--yes"])).toEqual({ operation: "add", email: "sam@example.nz", yes: true });
    expect(parseOfficeUserCommand(["remove", "sam@example.nz"])).toEqual({ operation: "remove", email: "sam@example.nz", yes: false });
    expect(parseOfficeUserCommand(["list"])).toEqual({ operation: "list" });
    for (const args of [[], ["add"], ["remove", "invalid"], ["list", "someone@example.nz"], ["add", "sam@example.nz", "--bad"], ["list", "--yes", "--yes"]]) {
      expect(() => parseOfficeUserCommand(args)).toThrow();
    }
  });

  function cli(role: "CUSTOMER" | "ADMIN" = "CUSTOMER", answer = "") {
    const user = { id: randomUUID(), email: "sam@example.nz", role };
    const users = {
      find: vi.fn().mockResolvedValue(user), list: vi.fn().mockResolvedValue([{ email: user.email, since: null }]),
      add: vi.fn().mockResolvedValue({ ...user, role: "ADMIN", changed: true }),
      remove: vi.fn().mockResolvedValue({ ...user, role: "CUSTOMER", changed: true }),
    };
    const print = vi.fn();
    const confirm = vi.fn().mockResolvedValue(answer);
    return { users, print, confirm };
  }

  it("prints the exact change before confirmation and defaults to no", async () => {
    const deps = cli();
    await runOfficeUserCommand({ operation: "add", email: "sam@example.nz", yes: false }, deps);
    expect(deps.print.mock.calls.map(([line]) => line)).toEqual([
      "Set sam@example.nz from CUSTOMER to ADMIN.", "Cancelled. No changes made.",
    ]);
    expect(deps.print.mock.invocationCallOrder[0]).toBeLessThan(deps.confirm.mock.invocationCallOrder[0]);
    expect(deps.users.add).not.toHaveBeenCalled();
  });

  it("confirms removal, including session revocation, and accepts y", async () => {
    const deps = cli("ADMIN", "Y");
    await runOfficeUserCommand({ operation: "remove", email: "sam@example.nz", yes: false }, deps);
    expect(deps.print).toHaveBeenCalledWith("Revoke all current sessions and refresh tokens. Office access ends immediately.");
    expect(deps.users.remove).toHaveBeenCalledWith("sam@example.nz");
  });

  it("--yes skips the question but still prints the proposed change", async () => {
    const deps = cli();
    await runOfficeUserCommand({ operation: "add", email: "sam@example.nz", yes: true }, deps);
    expect(deps.confirm).not.toHaveBeenCalled();
    expect(deps.print).toHaveBeenCalledWith("Set sam@example.nz from CUSTOMER to ADMIN.");
    expect(deps.users.add).toHaveBeenCalledOnce();
  });

  it("does not prompt or write for an existing role, and lists unknown grant dates honestly", async () => {
    const deps = cli("ADMIN");
    await runOfficeUserCommand({ operation: "add", email: "sam@example.nz", yes: false }, deps);
    expect(deps.confirm).not.toHaveBeenCalled();
    expect(deps.users.add).not.toHaveBeenCalled();
    await runOfficeUserCommand({ operation: "list" }, deps);
    expect(deps.print).toHaveBeenCalledWith("sam@example.nz\tSince unknown (predates office-user audit)");
  });
});

describe.skipIf(!testDatabaseUrl)("office users in Postgres", () => {
  const schema = useTestSchema(import.meta.filename);
  // Plain Postgres has only the auth.users fixture from the migrations. Model Auth's session tables here,
  // never in an application migration and never by touching a Supabase project.
  beforeAll(async () => {
    await schema.db.$executeRaw`CREATE TABLE IF NOT EXISTS auth.sessions (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users(id))`;
    await schema.db.$executeRaw`CREATE TABLE IF NOT EXISTS auth.refresh_tokens (id bigserial PRIMARY KEY, user_id text NOT NULL)`;
  });
  beforeEach(async () => { await schema.db.profile.deleteMany(); });

  async function person(role: "CUSTOMER" | "TRADIE" | "ADMIN" = "CUSTOMER") {
    const id = randomUUID();
    const email = `${id}@example.nz`;
    await schema.db.$executeRaw`INSERT INTO auth.users (id, email) VALUES (${id}::uuid, ${email})`;
    return schema.db.profile.create({ data: { id, email, firstName: "Test", role } });
  }

  it("adds an existing account once and audits the role change as script", async () => {
    const profile = await person();
    const users = officeUsers(schema.db);
    expect(await users.add(` ${profile.email.toUpperCase()} `)).toMatchObject({ role: "ADMIN", changed: true });
    expect(await users.add(profile.email)).toMatchObject({ role: "ADMIN", changed: false });
    const rows = await schema.db.auditLog.findMany({ where: { recordId: profile.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorId: null, actorRole: null, reason: "script", action: "office_user.added", recordType: "profiles", before: { role: "CUSTOMER" }, after: { role: "ADMIN" } });
    expect(await users.list()).toEqual([{ email: profile.email, since: rows[0].createdAt }]);
  });

  it("returns legacy admins with an unknown grant date and no invented timestamp", async () => {
    const profile = await person("ADMIN");
    expect(await officeUsers(schema.db).list()).toEqual([{ email: profile.email, since: null }]);
  });

  it("refuses unknown email without creating an account", async () => {
    const users = officeUsers(schema.db);
    await expect(users.add("unknown@example.nz")).rejects.toMatchObject({ code: "unknown-account" });
    await expect(users.remove("unknown@example.nz")).rejects.toMatchObject({ code: "unknown-account" });
    expect(await schema.db.profile.count()).toBe(0);
  });

  it("demotes to CUSTOMER, calls session revocation and writes the removal audit atomically", async () => {
    await person("ADMIN");
    const profile = await person("ADMIN");
    const revoke = vi.fn().mockResolvedValue(undefined);
    const result = await officeUsers(schema.db, revoke).remove(profile.email);
    expect(result).toMatchObject({ role: "CUSTOMER", changed: true });
    expect(revoke).toHaveBeenCalledWith(expect.anything(), profile.id);
    expect(await schema.db.auditLog.findFirst({ where: { recordId: profile.id } })).toMatchObject({
      action: "office_user.removed", actorId: null, reason: "script", before: { role: "ADMIN" }, after: { role: "CUSTOMER" },
    });
  });

  it("rolls back role and audit when Auth session revocation fails", async () => {
    await person("ADMIN");
    const profile = await person("ADMIN");
    await expect(officeUsers(schema.db, async () => { throw new Error("Auth unavailable"); }).remove(profile.email)).rejects.toThrow("Auth unavailable");
    expect(await schema.db.profile.findUniqueOrThrow({ where: { id: profile.id } })).toMatchObject({ role: "ADMIN" });
    expect(await schema.db.auditLog.count({ where: { recordId: profile.id } })).toBe(0);
  });

  it("never removes the last ADMIN, including two simultaneous removals", async () => {
    const first = await person("ADMIN");
    const revoke = vi.fn().mockResolvedValue(undefined);
    const users = officeUsers(schema.db, revoke);
    await expect(users.remove(first.email)).rejects.toMatchObject({ code: "last-admin" });
    expect(revoke).not.toHaveBeenCalled();
    const second = await person("ADMIN");
    const results = await Promise.allSettled([users.remove(first.email), users.remove(second.email)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await schema.db.profile.count({ where: { role: "ADMIN" } })).toBe(1);
  });

  it("removes all the target's Auth sessions and refresh tokens, leaving another person's alone", async () => {
    const keeper = await person("ADMIN");
    const removed = await person("ADMIN");
    for (const profile of [keeper, removed, removed]) {
      await schema.db.$executeRaw`INSERT INTO auth.sessions (id, user_id) VALUES (${randomUUID()}::uuid, ${profile.id}::uuid)`;
      await schema.db.$executeRaw`INSERT INTO auth.refresh_tokens (user_id) VALUES (${profile.id})`;
    }
    await officeUsers(schema.db).remove(removed.email);
    const sessions = await schema.db.$queryRaw<{ user_id: string }[]>`SELECT user_id FROM auth.sessions WHERE user_id IN (${keeper.id}::uuid, ${removed.id}::uuid)`;
    const tokens = await schema.db.$queryRaw<{ user_id: string }[]>`SELECT user_id FROM auth.refresh_tokens WHERE user_id IN (${keeper.id}, ${removed.id})`;
    expect(sessions).toEqual([{ user_id: keeper.id }]);
    expect(tokens).toEqual([{ user_id: keeper.id }]);
  });

  it("does not demote a worker who is not an office user", async () => {
    const profile = await person("TRADIE");
    const revoke = vi.fn();
    expect(await officeUsers(schema.db, revoke).remove(profile.email)).toMatchObject({ role: "TRADIE", changed: false });
    expect(revoke).not.toHaveBeenCalled();
  });
});
