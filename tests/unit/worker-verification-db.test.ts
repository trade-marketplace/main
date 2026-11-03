import { randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, it, vi } from "vitest";

import type { Role } from "@/generated/prisma/client";
import { transitionJob } from "@/server/jobs/status-machine";
import { recordWorkerCheck } from "@/server/workers/office-checks";
import { verifiedBadgeFor } from "@/server/workers/verification";
import { testDatabaseUrl, useTestSchema } from "../support/test-db";

const NOW = new Date("2026-11-03T00:00:00Z");
const PHONE = "+64210000002";
describe.skipIf(!testDatabaseUrl)("worker verification in Postgres", () => {
  const schema = useTestSchema(import.meta.filename);
  async function person(role: Role = "CUSTOMER") {
    const id = randomUUID(), email = `${id}@example.test`;
    await schema.db.$executeRaw`INSERT INTO auth.users(id,email) VALUES(${id}::uuid,${email})`;
    return schema.db.profile.create({ data: { id, email, firstName: "Example", role, emailVerifiedAt: NOW, phone: PHONE } });
  }
  async function worker() {
    const profile = await person("TRADIE"), admin = await person("ADMIN");
    await schema.db.workerProfile.create({ data: { userId: profile.id, verifiedAt: NOW, verifiedById: admin.id } });
    await schema.db.workerTrade.create({ data: { userId: profile.id, trade: "OTHER" } });
    return { profile, actor: { userId: admin.id } };
  }
  async function checkedWorker() {
    const result = await worker();
    await recordWorkerCheck(schema.db, result.actor, result.profile.id, { kind: "identity-checked" }, NOW);
    await recordWorkerCheck(schema.db, result.actor, result.profile.id, { kind: "phone-confirmed", expectedPhone: PHONE }, NOW);
    return result;
  }
  async function job() {
    return schema.db.job.create({ data: { customerId: (await person()).id, title: "Hang a door", description: "Example job", category: "OTHER", addressLine1: "1 Example Street", suburb: "Gladstone", city: "Invercargill", status: "BOOKABLE", priceCents: 12_000 } });
  }

  it("does not backfill identity/phone proof from the legacy generic verified flag", async () => {
    const { profile } = await worker();
    expect(await verifiedBadgeFor(schema.db, profile.id, "OTHER", NOW)).toBe(false);
    expect(await schema.db.workerProfile.findUnique({ where: { userId: profile.id } })).toMatchObject({ verifiedAt: NOW, identityCheckedAt: null, pausedAt: null });
    expect(await schema.db.profile.findUnique({ where: { id: profile.id } })).toMatchObject({ phoneVerifiedAt: null, phoneVerifiedFor: null });
  });

  it("records trusted office evidence with the real actor and no raw phone in the audit", async () => {
    const { profile, actor } = await checkedWorker();
    expect(await verifiedBadgeFor(schema.db, profile.id, "OTHER", NOW)).toBe(true);
    const audit = await schema.db.auditLog.findMany({ where: { recordId: profile.id }, orderBy: { createdAt: "asc" } });
    expect(audit.map(row => row.action)).toEqual(["worker.identity_checked", "worker.phone_confirmed"]);
    expect(audit.every(row => row.actorId === actor.userId && row.actorRole === "ADMIN")).toBe(true);
    expect(JSON.stringify(audit)).not.toContain(PHONE);
    expect(audit[1].after).toEqual({ phoneVerifiedAt: NOW.toISOString() });
  });

  it("rejects an unauthorized office actor, stale phone, missing reason and non-worker without writing proof", async () => {
    const { profile, actor } = await worker(), customer = await person();
    await expect(recordWorkerCheck(schema.db, { userId: profile.id }, profile.id, { kind: "identity-checked" }, NOW)).rejects.toThrow("office-access-required");
    await expect(recordWorkerCheck(schema.db, actor, profile.id, { kind: "phone-confirmed", expectedPhone: "+64210000003" }, NOW)).rejects.toThrow("phone-changed");
    await expect(recordWorkerCheck(schema.db, actor, profile.id, { kind: "paused", reason: " " }, NOW)).rejects.toThrow("pause-reason-required");
    await expect(recordWorkerCheck(schema.db, actor, customer.id, { kind: "identity-checked" }, NOW)).rejects.toThrow("worker-required");
    expect(await schema.db.auditLog.count({ where: { recordId: profile.id } })).toBe(0);
  });

  it("invalidates the phone proof even for a direct server write and rejects unbound proof", async () => {
    const { profile, actor } = await checkedWorker();
    await schema.db.profile.update({ where: { id: profile.id }, data: { phone: "+64210000003" } });
    expect(await schema.db.profile.findUnique({ where: { id: profile.id } })).toMatchObject({ phoneVerifiedAt: null, phoneVerifiedFor: null });
    expect(await verifiedBadgeFor(schema.db, profile.id, "OTHER", NOW)).toBe(false);
    await expect(recordWorkerCheck(schema.db, actor, profile.id, { kind: "phone-confirmed", expectedPhone: PHONE }, NOW)).rejects.toThrow("phone-changed");
    await expect(schema.db.profile.update({ where: { id: profile.id }, data: { phoneVerifiedAt: NOW, phoneVerifiedFor: PHONE } })).rejects.toThrow(/phone_verification_is_bound/);
    await expect(schema.db.profile.update({ where: { id: profile.id }, data: { phoneVerifiedAt: NOW, phoneVerifiedFor: null } })).rejects.toThrow(/phone_verification_is_bound/);
    await recordWorkerCheck(schema.db, actor, profile.id, { kind: "phone-confirmed", expectedPhone: "+64210000003" }, NOW);
    expect(await verifiedBadgeFor(schema.db, profile.id, "OTHER", NOW)).toBe(true);
  });

  it("removes badge and claiming immediately on office pause, while assigned work can continue", async () => {
    const { profile, actor } = await checkedWorker(), existing = await job(), unclaimed = await job();
    await schema.db.job.update({ where: { id: existing.id }, data: { workerId: profile.id, status: "ASSIGNED" } });
    await recordWorkerCheck(schema.db, actor, profile.id, { kind: "paused", reason: "Office investigation" }, NOW);
    expect(await verifiedBadgeFor(schema.db, profile.id, "OTHER", NOW)).toBe(false);
    const deps = { audit: vi.fn(), notify: vi.fn() };
    await expect(transitionJob(schema.db, deps, { jobId: unclaimed.id, transition: "claim", actor: { role: "TRADIE", userId: profile.id } })).rejects.toMatchObject({ failure: "worker-paused" });
    expect(deps.audit).not.toHaveBeenCalled();
    await expect(schema.db.job.update({ where: { id: unclaimed.id }, data: { workerId: profile.id, status: "ASSIGNED" } })).rejects.toThrow(/Worker is paused/);
    await schema.db.job.update({ where: { id: existing.id }, data: { description: "Still completing assigned work" } });
    expect(await schema.db.job.findUnique({ where: { id: unclaimed.id } })).toMatchObject({ status: "BOOKABLE", workerId: null });
    await recordWorkerCheck(schema.db, actor, profile.id, { kind: "unpaused" }, NOW);
    expect(await verifiedBadgeFor(schema.db, profile.id, "OTHER", NOW)).toBe(true);
    await transitionJob(schema.db, deps, { jobId: unclaimed.id, transition: "claim", actor: { role: "TRADIE", userId: profile.id } });
    expect(await schema.db.job.findUnique({ where: { id: unclaimed.id } })).toMatchObject({ status: "ASSIGNED", workerId: profile.id });
    const entries = await schema.db.auditLog.findMany({ where: { recordId: profile.id, action: { in: ["worker.paused", "worker.unpaused"] } } });
    expect(entries).toHaveLength(2);
    expect(entries.find(row => row.action === "worker.paused")).toMatchObject({ actorId: actor.userId, actorRole: "ADMIN", reason: "Office investigation" });
  });

  it("serializes a claim waiting behind a concurrent pause and rejects it after the pause commits", async () => {
    const { profile, actor } = await checkedWorker(), unclaimed = await job();
    const claimant = new pg.Client({ connectionString: testDatabaseUrl, application_name: `verification-race-${schema.name}` });
    await claimant.connect();
    let assignment: Promise<pg.QueryResult> | undefined;
    try {
      await claimant.query(`SET search_path TO "${schema.name}"`);
      await schema.db.$transaction(async tx => {
        await tx.workerProfile.update({ where: { userId: profile.id }, data: { pausedAt: NOW, pausedById: actor.userId } });
        // The assignment reads the old visible row, then waits for the in-flight office row lock.
        assignment = claimant.query("UPDATE jobs SET worker_id=$1,status='ASSIGNED' WHERE id=$2", [profile.id, unclaimed.id]);
        assignment.catch(() => {}); // Observe the rejection below after this transaction commits.
        let waiting = false;
        for (let attempt = 0; attempt < 80 && !waiting; attempt++) {
          const rows = await tx.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS(SELECT FROM pg_stat_activity WHERE application_name = ${`verification-race-${schema.name}`} AND wait_event_type='Lock') AS waiting`;
          waiting = rows[0].waiting;
          if (!waiting) await new Promise(resolve => setTimeout(resolve, 25));
        }
        expect(waiting).toBe(true);
      });
      await expect(assignment).rejects.toMatchObject({ code: "23514" });
      expect(await schema.db.job.findUnique({ where: { id: unclaimed.id } })).toMatchObject({ workerId: null, status: "BOOKABLE" });
    } finally { await claimant.end(); }
  });

  it("keeps own-row reads but prevents Data API clients forging proof, identity or pause fields", async () => {
    const { profile } = await worker();
    await schema.db.$executeRawUnsafe(`DO $$ BEGIN CREATE ROLE tm_verification_reader NOLOGIN; EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL; END $$`);
    await schema.db.$executeRawUnsafe(`GRANT USAGE ON SCHEMA "${schema.name}", auth TO tm_verification_reader`);
    await schema.db.$executeRawUnsafe(`GRANT SELECT, UPDATE ON "${schema.name}".profiles, "${schema.name}".worker_profiles TO tm_verification_reader`);
    await schema.db.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE tm_verification_reader");
      await tx.$executeRaw`SELECT set_config('request.jwt.claims', ${JSON.stringify({ sub: profile.id })}, true)`;
      expect(await tx.$queryRawUnsafe(`SELECT id FROM "${schema.name}".profiles`)).toEqual([{ id: profile.id }]);
      expect(await tx.$queryRawUnsafe(`UPDATE "${schema.name}".profiles SET phone_verified_at=now(),phone_verified_for=phone WHERE id=$1::uuid RETURNING id`, profile.id)).toEqual([]);
      expect(await tx.$queryRawUnsafe(`UPDATE "${schema.name}".worker_profiles SET identity_checked_at=now(),identity_checked_by_id=user_id,paused_at=NULL WHERE user_id=$1::uuid RETURNING user_id`, profile.id)).toEqual([]);
    });
    expect(await verifiedBadgeFor(schema.db, profile.id, "OTHER", NOW)).toBe(false);
    const publicExecution = await schema.db.$queryRaw<{ granted: boolean }[]>`SELECT EXISTS(SELECT FROM information_schema.routine_privileges WHERE routine_schema=${schema.name} AND routine_name IN ('invalidate_worker_phone_proof','deny_paused_worker_assignment') AND grantee='PUBLIC' AND privilege_type='EXECUTE') AS granted`;
    expect(publicExecution[0].granted).toBe(false);
    const mutationGrants = await schema.db.$queryRaw<{ grantee: string }[]>`SELECT grantee FROM information_schema.role_table_grants WHERE table_schema=${schema.name} AND table_name IN ('profiles','worker_profiles') AND grantee IN ('PUBLIC','anon','authenticated') AND privilege_type IN ('INSERT','UPDATE','DELETE')`;
    expect(mutationGrants).toEqual([]);
    const tables = await schema.db.$queryRaw<{ relrowsecurity: boolean }[]>`SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=${schema.name} AND c.relname IN ('profiles','worker_profiles')`;
    expect(tables).toHaveLength(2);
    expect(tables.every(row => row.relrowsecurity)).toBe(true);
  });
});
