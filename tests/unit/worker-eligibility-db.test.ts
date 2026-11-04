import { randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, it, vi } from "vitest";
import type { JobStatus, Role, Trade } from "@/generated/prisma/client";
import { applyTransition, transitionJob } from "@/server/jobs/status-machine";
import { canClaim, eligibleJobsFor, JOB_ELIGIBILITY_SELECT, WORKER_ELIGIBILITY_SELECT } from "@/server/workers/eligibility";
import { lockEligibilityRows, saveEligibleEstimate } from "@/server/workers/eligibility-mutations";
import { submitWorkerEstimate } from "@/server/jobs/worker-estimate";
import { testDatabaseUrl, useTestSchema } from "../support/test-db";

const NOW = new Date("2026-11-03T00:00:00Z");
const CENTRE = { lat: -46.4132, lng: 168.3538 };
describe.skipIf(!testDatabaseUrl)("worker eligibility at the real mutation boundary", () => {
  const schema = useTestSchema(import.meta.filename);
  async function person(role: Role = "CUSTOMER") {
    const id = randomUUID(), email = `${id}@example.test`;
    await schema.db.$executeRaw`INSERT INTO auth.users(id,email) VALUES(${id}::uuid,${email})`;
    return schema.db.profile.create({ data: { id, email, role, firstName: "Example", emailVerifiedAt: NOW } });
  }
  async function worker(trade: Trade = "ELECTRICAL") {
    const profile = await person("TRADIE"), office = await person("ADMIN");
    await schema.db.workerProfile.create({ data: { userId: profile.id, identityCheckedAt: NOW, identityCheckedById: office.id,
      baseSuburb: "Invercargill", areaLat: CENTRE.lat, areaLng: CENTRE.lng, areaRadiusKm: 25, available: true } });
    if (trade !== "OTHER") {
      await schema.db.workerTrade.create({ data: { userId: profile.id, trade } });
      await schema.db.licence.create({ data: { userId: profile.id, trade, number: "EW123456", status: "VERIFIED", checkedAt: NOW, checkedById: office.id, expiresOn: new Date("2027-11-03") } });
    }
    return profile;
  }
  async function job(status: JobStatus = "BOOKABLE", category: Trade = "ELECTRICAL", owner?: string, at?: Date) {
    return schema.db.job.create({ data: { customerId: owner ?? (await person()).id, category, status, title: "Example work", description: "Private work description", addressLine1: "1 Private Street", suburb: "Gladstone", city: "Invercargill",
      priceCents: status === "BOOKABLE" ? 12_000 : null, lat: CENTRE.lat, lng: CENTRE.lng, approxLat: CENTRE.lat + 0.0015, approxLng: CENTRE.lng,
      ...(at ? { createdAt: at, updatedAt: at } : {}) } });
  }
  const deps = () => ({ audit: vi.fn(async () => {}), notify: vi.fn(async () => {}) });
  const claim = (workerId: string, jobId: string) => transitionJob(schema.db, deps(), { transition: "claim", actor: { role: "TRADIE", userId: workerId }, jobId });

  it("earns one quote point per job, never for an edit or a refused quote, and keeps the ledger server-only (#488)", async () => {
    const tradie = await worker("OTHER"), first = await job("REVIEW", "OTHER"), second = await job("REVIEW", "OTHER"), priced = await job("BOOKABLE", "OTHER");
    expect(await saveEligibleEstimate(schema.db, { userId: tradie.id }, first.id, { minutes: 60 })).toMatchObject({ pointsAwarded: 1, points: 1 });
    expect(await saveEligibleEstimate(schema.db, { userId: tradie.id }, first.id, { minutes: 90 })).toMatchObject({ pointsAwarded: 0, points: 1 });
    await expect(saveEligibleEstimate(schema.db, { userId: tradie.id }, priced.id, { minutes: 60 })).rejects.toMatchObject({ failure: "not-open" });
    expect(await saveEligibleEstimate(schema.db, { userId: tradie.id }, second.id, { minutes: 60 })).toMatchObject({ pointsAwarded: 1, points: 2 });
    expect(await schema.db.pointEntry.count({ where: { workerId: tradie.id } })).toBe(2);
    await expect(schema.db.pointEntry.create({ data: { workerId: tradie.id, jobId: first.id, delta: -1, reason: "QUOTE" } })).rejects.toThrow();
    const rls = await schema.db.$queryRawUnsafe<{ relrowsecurity: boolean; policies: bigint }[]>(`SELECT c.relrowsecurity, (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies FROM pg_class c WHERE c.oid = '"${schema.name}".point_entries'::regclass`);
    expect(rls).toEqual([{ relrowsecurity: true, policies: 0n }]);
  });

  it("saves and edits only the authenticated worker’s blind estimate, refusing a price or eligibility change", async () => {
    const first = await worker("OTHER"), second = await worker("OTHER"), review = await job("REVIEW", "OTHER");
    const input = { hours: "3.5", materials: "85.00", note: "Office only", needsSiteVisit: true };
    const viewer = { userId: first.id, role: "TRADIE" as const };
    expect(await submitWorkerEstimate(schema.db, viewer, review.id, { ...input, workerId: second.id })).toMatchObject({ status: "invalid" });
    expect(await schema.db.estimate.count({ where: { jobId: review.id } })).toBe(0);
    expect(await submitWorkerEstimate(schema.db, viewer, review.id, input)).toEqual({ status: "saved", estimate: { minutes: 210, materialsCents: 8500, note: "Office only", needsSiteVisit: true, madeBeforeEdit: false }, pointsAwarded: 1, points: 1 });
    await saveEligibleEstimate(schema.db, { userId: second.id }, review.id, { minutes: 300, materialsCents: 19000, note: "Someone else" });
    await schema.db.estimate.updateMany({ where: { jobId: review.id, workerId: first.id }, data: { madeBeforeEdit: true } });
    expect(await submitWorkerEstimate(schema.db, viewer, review.id, { ...input, hours: "4" })).toMatchObject({ status: "saved", estimate: { minutes: 240, madeBeforeEdit: false } });
    expect(await schema.db.estimate.findUnique({ where: { jobId_workerId: { jobId: review.id, workerId: second.id } } })).toMatchObject({ minutes: 300, materialsCents: 19000, note: "Someone else" });
    await schema.db.workerProfile.update({ where: { userId: first.id }, data: { pausedAt: NOW } });
    expect(await submitWorkerEstimate(schema.db, viewer, review.id, input)).toEqual({ status: "ineligible", failure: "worker-paused" });
    await schema.db.workerProfile.update({ where: { userId: first.id }, data: { pausedAt: null } });
    await schema.db.job.update({ where: { id: review.id }, data: { status: "PRICED", priceCents: 12_000 } });
    expect(await submitWorkerEstimate(schema.db, viewer, review.id, input)).toEqual({ status: "ineligible", failure: "not-open" });
    expect(await schema.db.estimate.findUnique({ where: { jobId_workerId: { jobId: review.id, workerId: first.id } } })).toMatchObject({ minutes: 240 });
    expect(await submitWorkerEstimate(schema.db, { ...viewer, role: "CUSTOMER" }, review.id, input)).toEqual({ status: "ineligible", failure: "worker-required" });
  });

  it("uses the same private facts for ID discovery, claim and estimate, without a phone or Other selection gate", async () => {
    const tradie = await worker("OTHER"), ready = await job("BOOKABLE", "OTHER"), review = await job("REVIEW", "OTHER");
    const current = await schema.db.profile.findUniqueOrThrow({ where: { id: tradie.id }, select: WORKER_ELIGIBILITY_SELECT });
    const rows = await schema.db.job.findMany({ where: { id: { in: [ready.id, review.id] } }, select: JOB_ELIGIBILITY_SELECT });
    expect(eligibleJobsFor(current, rows).sort()).toEqual([ready.id, review.id].sort());
    expect(JSON.stringify(eligibleJobsFor(current, rows))).not.toMatch(/Private Street|priceCents|approxLat|customerId/);
    expect(await saveEligibleEstimate(schema.db, { userId: tradie.id }, review.id, { minutes: 90 })).toHaveProperty("id");
    await claim(tradie.id, ready.id);
    expect(await schema.db.job.findUnique({ where: { id: ready.id } })).toMatchObject({ status: "ASSIGNED", workerId: tradie.id });
    expect(await schema.db.profile.findUnique({ where: { id: tradie.id } })).toMatchObject({ phoneVerifiedAt: null, phoneVerifiedFor: null });
    expect(await schema.db.workerTrade.count({ where: { userId: tradie.id } })).toBe(0);
  });

  it("checks mutations again after an eligible discovery, never trusting a stored decision", async () => {
    const tradie = await worker(), ready = await job(), review = await job("REVIEW");
    const before = await schema.db.profile.findUniqueOrThrow({ where: { id: tradie.id }, select: WORKER_ELIGIBILITY_SELECT });
    expect(canClaim(before, await schema.db.job.findUniqueOrThrow({ where: { id: ready.id }, select: JOB_ELIGIBILITY_SELECT }))).toBe(true);
    await schema.db.licence.updateMany({ where: { userId: tradie.id }, data: { expiresOn: new Date("2026-11-02") } });
    await expect(claim(tradie.id, ready.id)).rejects.toMatchObject({ failure: "licence-required" });
    await expect(saveEligibleEstimate(schema.db, { userId: tradie.id }, review.id, { minutes: 60 })).rejects.toMatchObject({ failure: "licence-required" });
    expect(await schema.db.estimate.count({ where: { jobId: review.id } })).toBe(0);
  });

  it("preserves job timestamps/history on estimate insert and update, while a true claim still advances them", async () => {
    const tradie = await worker("OTHER"), old = new Date("2026-01-01T00:00:00Z");
    const review = await job("REVIEW", "OTHER", undefined, old);
    const before = await schema.db.job.findUniqueOrThrow({ where: { id: review.id } });
    const historyBefore = await schema.db.jobStatusHistory.findMany({ where: { jobId: review.id } });
    const estimate = await saveEligibleEstimate(schema.db, { userId: tradie.id }, review.id, { minutes: 60 });
    expect(await schema.db.job.findUnique({ where: { id: review.id } })).toMatchObject({ updatedAt: before.updatedAt, editedAt: before.editedAt });
    expect(await saveEligibleEstimate(schema.db, { userId: tradie.id }, review.id, { minutes: 120 })).toEqual({ ...estimate, pointsAwarded: 0 });
    expect(await schema.db.job.findUnique({ where: { id: review.id } })).toMatchObject({ updatedAt: before.updatedAt, editedAt: before.editedAt });
    expect(await schema.db.jobStatusHistory.findMany({ where: { jobId: review.id } })).toEqual(historyBefore);
    const ready = await job("BOOKABLE", "OTHER", undefined, old);
    await claim(tradie.id, ready.id);
    const assigned = await schema.db.job.findUniqueOrThrow({ where: { id: ready.id } });
    expect(assigned.updatedAt.getTime()).toBeGreaterThan(ready.updatedAt.getTime());
    expect(assigned.editedAt).toEqual(ready.editedAt);
    expect(await schema.db.jobStatusHistory.count({ where: { jobId: ready.id } })).toBe(2);
    const triggers = await schema.db.$queryRaw<{ tgname: string }[]>`SELECT t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=${schema.name} AND c.relname='jobs' AND NOT t.tgisinternal AND (t.tgtype & 2)=2 ORDER BY t.tgname`;
    const names = triggers.map(row => row.tgname);
    expect(names).toContain("jobs_worker_eligibility_lock");
    expect(names.indexOf("jobs_worker_eligibility_lock")).toBeGreaterThan(names.indexOf("jobs_set_updated_at"));
  });

  it("prevents own-job estimates through both the server command and direct database writes/reassignment", async () => {
    const tradie = await worker("OTHER"), own = await job("REVIEW", "OTHER", tradie.id), other = await job("REVIEW", "OTHER");
    const updatedAt = own.updatedAt;
    await expect(saveEligibleEstimate(schema.db, { userId: tradie.id }, own.id, { minutes: 60 })).rejects.toMatchObject({ failure: "own-job" });
    expect(await schema.db.job.findUnique({ where: { id: own.id } })).toMatchObject({ updatedAt });
    await expect(schema.db.estimate.create({ data: { jobId: own.id, workerId: tradie.id, minutes: 60 } })).rejects.toThrow(/Cannot estimate your own job/);
    const valid = await saveEligibleEstimate(schema.db, { userId: tradie.id }, other.id, { minutes: 60 });
    await expect(schema.db.estimate.update({ where: { id: valid.id }, data: { jobId: own.id } })).rejects.toThrow(/Cannot estimate your own job/);
    // A legacy row can become an own estimate if an office/import later changes the job's owner.
    await schema.db.job.update({ where: { id: other.id }, data: { customerId: tradie.id } });
    await expect(schema.db.estimate.update({ where: { id: valid.id }, data: { minutes: 120 } })).rejects.toThrow(/Cannot estimate your own job/);
    // System edit flags are metadata, not an estimate by the worker, and must not break a job edit.
    await schema.db.estimate.update({ where: { id: valid.id }, data: { madeBeforeEdit: true } });
    await expect(claim(tradie.id, (await job("BOOKABLE", "OTHER", tradie.id)).id)).rejects.toMatchObject({ failure: "own-job" });
  });

  it.each([
    ["office pause", "worker_profiles", "paused_at=now()", "user_id", "worker-paused"],
    ["ID revoked", "worker_profiles", "identity_checked_at=NULL,identity_checked_by_id=NULL", "user_id", "identity-required"],
    ["role changed", "profiles", "role='CUSTOMER'", "id", "worker-required"],
    ["email proof removed", "profiles", "email_verified_at=NULL", "id", "email-required"],
    ["licence rejected", "licences", "status='REJECTED',rejection_reason='Needs review'", "user_id", "licence-required"],
    ["licence expired", "licences", "expires_on='2026-11-02'", "user_id", "licence-required"],
    ["work area moved", "worker_profiles", "area_lat=-36.85,area_lng=174.76", "user_id", "outside-work-area"],
  ])("waits behind %s and rechecks the committed proof before claiming", async (_name, table, set, key, failure) => {
    const tradie = await worker(), ready = await job();
    let attempt: Promise<unknown> | undefined;
    await schema.db.$transaction(async tx => {
      await tx.$executeRawUnsafe(`UPDATE "${schema.name}"."${table}" SET ${set} WHERE "${key}"=$1::uuid`, tradie.id);
      attempt = claim(tradie.id, ready.id);
      attempt.catch(() => {});
      let waiting = false;
      for (let tries = 0; tries < 80 && !waiting; tries++) {
        await tx.$executeRaw`SELECT pg_stat_clear_snapshot()`;
        const rows = await tx.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS(SELECT FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE ${`%${schema.name}%jobs%`}) AS waiting`;
        waiting = rows[0].waiting;
        if (!waiting) await new Promise(resolve => setTimeout(resolve, 25));
      }
      expect(waiting).toBe(true);
    });
    await expect(attempt).rejects.toMatchObject({ failure });
    expect(await schema.db.job.findUnique({ where: { id: ready.id } })).toMatchObject({ status: "BOOKABLE", workerId: null });
  });

  it("holds proofs through the mutation, keeps proof timestamps unchanged and serializes two jobs for the same worker", async () => {
    const tradie = await worker(), first = await job(), second = await job();
    const profileBefore = await schema.db.profile.findUniqueOrThrow({ where: { id: tradie.id } });
    const workerBefore = await schema.db.workerProfile.findUniqueOrThrow({ where: { userId: tradie.id } });
    const licenceBefore = await schema.db.licence.findFirstOrThrow({ where: { userId: tradie.id } });
    await Promise.all([claim(tradie.id, first.id), claim(tradie.id, second.id)]);
    expect(await schema.db.job.count({ where: { workerId: tradie.id, status: "ASSIGNED" } })).toBe(2);
    expect((await schema.db.profile.findUniqueOrThrow({ where: { id: tradie.id } })).updatedAt).toEqual(profileBefore.updatedAt);
    expect((await schema.db.workerProfile.findUniqueOrThrow({ where: { userId: tradie.id } })).updatedAt).toEqual(workerBefore.updatedAt);
    expect((await schema.db.licence.findFirstOrThrow({ where: { userId: tradie.id } })).updatedAt).toEqual(licenceBefore.updatedAt);
  });

  it("blocks an office proof change until the already-authorized mutation commits", async () => {
    const tradie = await worker(), ready = await job();
    const changer = new pg.Client({ connectionString: testDatabaseUrl, application_name: `eligibility-change-${schema.name}` });
    await changer.connect();
    let changed: Promise<pg.QueryResult> | undefined;
    try {
      await schema.db.$transaction(async tx => {
        await lockEligibilityRows(tx, tradie.id, ready.id);
        changed = changer.query(`UPDATE "${schema.name}".worker_profiles SET paused_at=now() WHERE user_id=$1`, [tradie.id]);
        changed.catch(() => {});
        const result = await applyTransition(tx, deps(), { transition: "claim", actor: { role: "TRADIE", userId: tradie.id }, jobId: ready.id });
        expect(result.to).toBe("ASSIGNED");
        const rows = await tx.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS(SELECT FROM pg_stat_activity WHERE application_name=${`eligibility-change-${schema.name}`} AND wait_event_type='Lock') AS waiting`;
        expect(rows[0].waiting).toBe(true);
      });
      await changed;
      expect(await schema.db.workerProfile.findUnique({ where: { userId: tradie.id } })).toMatchObject({ pausedAt: expect.any(Date) });
      expect(await schema.db.job.findUnique({ where: { id: ready.id } })).toMatchObject({ status: "ASSIGNED", workerId: tradie.id });
    } finally { await changer.end(); }
  });

  it("rechecks job ownership after an estimate waits for the job row", async () => {
    const tradie = await worker("OTHER"), review = await job("REVIEW", "OTHER");
    let attempt: Promise<unknown> | undefined;
    await schema.db.$transaction(async tx => {
      await tx.job.update({ where: { id: review.id }, data: { customerId: tradie.id } });
      attempt = saveEligibleEstimate(schema.db, { userId: tradie.id }, review.id, { minutes: 60 });
      attempt.catch(() => {});
      let waiting = false;
      for (let tries = 0; tries < 80 && !waiting; tries++) {
        await tx.$executeRaw`SELECT pg_stat_clear_snapshot()`;
        const rows = await tx.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS(SELECT FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE ${`%${schema.name}%jobs%`}) AS waiting`;
        waiting = rows[0].waiting;
        if (!waiting) await new Promise(resolve => setTimeout(resolve, 25));
      }
      expect(waiting).toBe(true);
    });
    await expect(attempt).rejects.toMatchObject({ failure: "own-job" });
    expect(await schema.db.estimate.count({ where: { jobId: review.id } })).toBe(0);
  });

  it("does not turn a lock-target GUC into Data API permission or leave the target set on the pool", async () => {
    const tradie = await worker("OTHER"), own = await job("REVIEW", "OTHER", tradie.id), other = await job("REVIEW", "OTHER");
    await schema.db.$executeRawUnsafe(`DO $$ BEGIN CREATE ROLE tm_eligibility_reader NOLOGIN; EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL; END $$`);
    await schema.db.$executeRawUnsafe(`GRANT USAGE ON SCHEMA "${schema.name}",auth TO tm_eligibility_reader`);
    await schema.db.$executeRawUnsafe(`GRANT SELECT,INSERT,UPDATE ON "${schema.name}".jobs,"${schema.name}".estimates TO tm_eligibility_reader`);
    await schema.db.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE tm_eligibility_reader");
      await tx.$executeRaw`SELECT set_config('request.jwt.claims', ${JSON.stringify({ sub: tradie.id })}, true)`;
      await tx.$executeRaw`SELECT set_config('app.eligibility_worker_id', ${tradie.id}, true)`;
      expect(await tx.$queryRawUnsafe(`UPDATE "${schema.name}".jobs SET updated_at=now() WHERE id=$1::uuid RETURNING id`, own.id)).toEqual([]);
    });
    await expect(schema.db.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE tm_eligibility_reader");
      await tx.$executeRaw`SELECT set_config('request.jwt.claims', ${JSON.stringify({ sub: tradie.id })}, true)`;
      await tx.$executeRawUnsafe(`INSERT INTO "${schema.name}".estimates(job_id,worker_id,minutes) VALUES($1::uuid,$2::uuid,60)`, other.id, tradie.id);
    })).rejects.toThrow(/row-level security/);
    await saveEligibleEstimate(schema.db, { userId: tradie.id }, other.id, { minutes: 60 });
    const setting = await schema.db.$queryRaw<{ value: string | null }[]>`SELECT current_setting('app.eligibility_worker_id',true) AS value`;
    expect(setting[0].value || "").toBe("");
    const functions = await schema.db.$queryRaw<{ grantee: string }[]>`SELECT grantee FROM information_schema.routine_privileges WHERE routine_schema=${schema.name} AND routine_name IN ('lock_worker_eligibility_rows','deny_own_job_estimate') AND grantee IN ('PUBLIC','anon','authenticated') AND privilege_type='EXECUTE'`;
    expect(functions).toEqual([]);
    const writes = await schema.db.$queryRaw<{ grantee: string }[]>`SELECT grantee FROM information_schema.table_privileges WHERE table_schema=${schema.name} AND table_name IN ('jobs','estimates') AND grantee IN ('PUBLIC','anon','authenticated') AND privilege_type IN ('INSERT','UPDATE','DELETE')`;
    expect(writes).toEqual([]);
  });
});
