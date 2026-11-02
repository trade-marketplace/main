import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Role } from "@/generated/prisma/client";
import type { Viewer } from "@/server/auth/viewer";
import { loadDraft, saveDraft } from "@/server/jobs/drafts";
import { postJob, postingDateRange, type PostJobDeps } from "@/server/jobs/post-job";
import { testDatabaseUrl, useTestSchema } from "../support/test-db";

describe.skipIf(!testDatabaseUrl)("drafts and posting a job (database)", () => {
  const schema = useTestSchema(import.meta.filename);
  const now = new Date("2026-11-02T13:00:00Z"); // Nov 3 in Auckland.
  async function person(role: Role = "CUSTOMER", verified = true): Promise<Viewer> {
    const id = randomUUID();
    await schema.db.$executeRaw`INSERT INTO auth.users (id) VALUES (${id}::uuid)`;
    await schema.db.profile.create({ data: { id, role, email: `${id}@example.nz`, firstName: "Test", emailVerifiedAt: verified ? now : null } });
    return { userId: id, role, email: `${id}@example.nz`, firstName: "Test", emailVerified: verified };
  }
  function input(viewer: Viewer, key: string) {
    return { postKey: key, description: "Move a sofa upstairs", category: "OTHER", photoPaths: [`drafts/${viewer.userId}/${key}/${"a".repeat(32)}.webp`], addressLine1: "1 Example St", suburb: "Gladstone", city: "Invercargill", locationSource: "SEARCH", point: { lat: -46.4132, lng: 168.3538 }, timeWindows: [{ date: "2026-11-03", timeOfDay: "MORNING" }] };
  }
  const deps = (extra: PostJobDeps = {}): PostJobDeps => ({ now: () => now, photoExists: async () => true, rateLimit: async () => ({ allowed: true }), notifyWorkers: async () => {}, ...extra });
  const post = (viewer: Viewer | null, data: unknown, key: string, extra: PostJobDeps = {}) => postJob(schema.db, viewer, data, key, deps(extra));

  it("saves step patches, restores the same posting key, and isolates each customer's draft", async () => {
    const customer = await person(); const other = await person(); const key = randomUUID();
    expect(await saveDraft(schema.db, customer, { postKey: key, description: "Move a sofa upstairs", category: "OTHER" })).toEqual({ status: "saved" });
    expect(await saveDraft(schema.db, customer, { photoPaths: [] })).toEqual({ status: "saved" });
    expect(await loadDraft(schema.db, customer)).toMatchObject({ postKey: key, description: "Move a sofa upstairs", photoPaths: [] });
    expect(await loadDraft(schema.db, other)).toBeNull();
    expect(await saveDraft(schema.db, customer, { description: "x" })).toMatchObject({ status: "invalid", fields: { description: "Describe the job" } });
    expect((await loadDraft(schema.db, customer))?.description).toBe("Move a sofa upstairs");
    await saveDraft(schema.db, customer, { anyTime: true, timeWindows: [{ date: "2026-11-03", timeOfDay: "MORNING" }] });
    await saveDraft(schema.db, customer, { description: "Move two sofas upstairs" });
    expect(await loadDraft(schema.db, customer)).toMatchObject({ anyTime: true, timeWindows: [{ date: "2026-11-03", timeOfDay: "MORNING" }] });
    expect(await saveDraft(schema.db, null, {})).toEqual({ status: "needs-account" });
  });

  it("posts REVIEW with the job number, actor history, photos, windows and audit, then deletes the draft", async () => {
    const customer = await person(); const key = randomUUID(); const data = input(customer, key);
    await saveDraft(schema.db, customer, data);
    const result = await post(customer, data, key);
    expect(result.status).toBe("posted"); if (result.status !== "posted") return;
    const job = await schema.db.job.findUniqueOrThrow({ where: { id: result.jobId }, include: { photos: true, timeWindows: true, statusHistory: true } });
    expect(job).toMatchObject({ status: "REVIEW", postKey: key, customerId: customer.userId, title: data.description, priceCents: null, coverage: "INSIDE" });
    expect(job.jobNumber).toBeGreaterThanOrEqual(1001);
    expect(job.photos).toHaveLength(1); expect(job.timeWindows).toHaveLength(1);
    expect(job.statusHistory).toEqual([expect.objectContaining({ fromStatus: null, toStatus: "REVIEW", changedById: customer.userId })]);
    expect(await schema.db.auditLog.findMany({ where: { recordId: job.id } })).toEqual([expect.objectContaining({ action: "job.posted", actorId: customer.userId })]);
    expect(await loadDraft(schema.db, customer)).toBeNull();
  });

  it("serializes concurrent double posts and replays the job even when the retry has changed input", async () => {
    const customer = await person(); const key = randomUUID(); const data = input(customer, key); const rateLimit = vi.fn(async () => ({ allowed: true } as const));
    const results = await Promise.all([post(customer, data, key, { rateLimit }), post(customer, data, key.toUpperCase(), { rateLimit })]);
    expect(results[0]).toEqual(results[1]); expect(rateLimit).toHaveBeenCalledTimes(1);
    expect(await post(customer, {}, key, { rateLimit: async () => ({ allowed: false, retryAfter: 60 }) })).toEqual(results[0]);
    expect(await schema.db.job.count({ where: { postKey: key } })).toBe(1);
  });

  it("rolls back the job, photos and draft deletion if the audit write fails", async () => {
    const customer = await person(); const key = randomUUID(); const data = input(customer, key);
    await saveDraft(schema.db, customer, data);
    await schema.db.$executeRawUnsafe(`CREATE FUNCTION "${schema.name}".reject_post_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'job.posted' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END $$`);
    await schema.db.$executeRawUnsafe(`CREATE TRIGGER reject_post_audit BEFORE INSERT ON "${schema.name}".audit_log FOR EACH ROW EXECUTE FUNCTION "${schema.name}".reject_post_audit()`);
    try { await expect(post(customer, data, key)).rejects.toThrow("test audit failure"); }
    finally { await schema.db.$executeRawUnsafe(`DROP TRIGGER reject_post_audit ON "${schema.name}".audit_log`); }
    expect(await schema.db.job.count({ where: { postKey: key } })).toBe(0);
    expect(await loadDraft(schema.db, customer)).toMatchObject({ postKey: key });
  });

  it("enables RLS with no browser policies on the private draft table", async () => {
    const rows = await schema.db.$queryRaw<{ relrowsecurity: boolean; policies: bigint }[]>`
      SELECT c.relrowsecurity, (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ${schema.name} AND c.relname = 'job_drafts'`;
    expect(rows).toEqual([{ relrowsecurity: true, policies: 0n }]);
  });

  it("never returns someone else's job or trusts a stale viewer role or verification flag", async () => {
    const customer = await person(); const other = await person(); const key = randomUUID();
    await post(customer, input(customer, key), key);
    expect(await post(other, input(other, key), key)).toEqual({ status: "forbidden" });
    const worker = await person("TRADIE");
    expect(await post({ ...worker, role: "CUSTOMER" }, input(worker, randomUUID()), randomUUID())).toEqual({ status: "forbidden" });
    const unverified = await person("CUSTOMER", false);
    expect(await post({ ...unverified, emailVerified: true }, {}, randomUUID())).toEqual({ status: "needs-account" });
  });

  it("keeps the draft through sign-up, then posts with the same key after verification", async () => {
    const customer = await person("CUSTOMER", false); const key = randomUUID(); const data = input(customer, key);
    await saveDraft(schema.db, customer, data);
    expect(await post(null, data, key)).toEqual({ status: "needs-account" });
    expect(await post(customer, data, key)).toEqual({ status: "needs-account" });
    expect(await loadDraft(schema.db, customer)).toMatchObject({ postKey: key });
    await schema.db.profile.update({ where: { id: customer.userId }, data: { emailVerifiedAt: now } });
    expect((await post(customer, data, key)).status).toBe("posted");
  });

  it("returns the existing area waitlist with email and leaves the draft intact outside coverage", async () => {
    const customer = await person(); const key = randomUUID(); const data = { ...input(customer, key), point: { lat: -36.85, lng: 174.76 } };
    await saveDraft(schema.db, customer, data);
    expect(await post(customer, data, key)).toMatchObject({ status: "outside-area", waitlist: { path: "/coming-soon", email: customer.email, suburb: data.suburb } });
    expect(await schema.db.job.count({ where: { postKey: key } })).toBe(0); expect(await loadDraft(schema.db, customer)).not.toBeNull();
  });

  it("blocks missing, still-uploading, foreign and unavailable photos without losing the draft", async () => {
    const customer = await person(); const key = randomUUID(); const data = input(customer, key);
    await saveDraft(schema.db, customer, data);
    expect(await post(customer, data, key, { photoExists: async () => false })).toEqual({ status: "photos-pending" });
    expect(await post(customer, data, key, { photoExists: async () => { throw new Error("storage unavailable"); } })).toEqual({ status: "photos-pending" });
    expect(await post(customer, { ...data, photoPaths: [`drafts/${randomUUID()}/${key}/${"a".repeat(32)}.webp`] }, key)).toEqual({ status: "photos-pending" });
    expect(await post(customer, { ...data, photoPaths: [] }, key)).toMatchObject({ status: "invalid", fields: { photoPaths: "Add some photos" } });
    expect(await loadDraft(schema.db, customer)).not.toBeNull();
  });

  it("uses the postJob rate limit without creating a job or deleting a draft", async () => {
    const customer = await person(); const key = randomUUID(); const data = input(customer, key);
    await saveDraft(schema.db, customer, data);
    expect(await post(customer, data, key, { rateLimit: async () => ({ allowed: false, retryAfter: 90 }) })).toEqual({ status: "rate-limited", retryAfter: 90 });
    expect(await loadDraft(schema.db, customer)).not.toBeNull(); expect(await schema.db.job.count({ where: { postKey: key } })).toBe(0);
  });

  it("returns mockup field prompts for invalid details, duplicate photos and stale windows", async () => {
    const customer = await person(); const key = randomUUID(); const data = input(customer, key);
    expect(await post(customer, { ...data, description: "short", addressLine1: "", timeWindows: [] }, key)).toMatchObject({ status: "invalid", fields: { description: "Describe the job", addressLine1: "Address", timeWindows: "When do you need it?" } });
    expect(await post(customer, { ...data, photoPaths: [data.photoPaths[0], data.photoPaths[0]] }, key)).toMatchObject({ status: "invalid" });
    expect(await post(customer, { ...data, timeWindows: [{ date: "2026-11-02", timeOfDay: "MORNING" }] }, key)).toMatchObject({ status: "invalid", fields: { timeWindows: "When do you need it?" } });
    expect(postingDateRange(now)).toEqual({ today: "2026-11-03", last: "2026-11-09" });
  });

  it("keeps successful posting committed when notifications fail", async () => {
    const customer = await person(); const key = randomUUID(); const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try { expect((await post(customer, input(customer, key), key, { notifyWorkers: async () => { throw new Error("offline"); } })).status).toBe("posted"); }
    finally { log.mockRestore(); }
    expect(await schema.db.job.count({ where: { postKey: key } })).toBe(1);
  });

  it("notifies only available workers with the matching trade inside their area, without leaking address", async () => {
    const customer = await person(); const key = randomUUID();
    const workers = await Promise.all([person("TRADIE"), person("TRADIE"), person("TRADIE")]);
    for (let i = 0; i < workers.length; i++) {
      await schema.db.workerTrade.create({ data: { userId: workers[i].userId, trade: "OTHER" } });
      await schema.db.workerProfile.create({ data: { userId: workers[i].userId, available: i !== 2, areaLat: i === 1 ? -36.85 : -46.4132, areaLng: 168.3538, areaRadiusKm: 10 } });
    }
    const result = await postJob(schema.db, customer, input(customer, key), key, { now: () => now, photoExists: async () => true, rateLimit: async () => ({ allowed: true }) });
    expect(result.status).toBe("posted"); if (result.status !== "posted") return;
    const rows = await schema.db.notification.findMany({ where: { type: "job.posted", payload: { path: ["jobId"], equals: result.jobId } } });
    expect(rows.map((r) => r.userId)).toEqual([workers[0].userId]);
    expect(rows[0].payload).toEqual({ jobId: result.jobId, jobNumber: result.jobNumber });
    // A later retry must not alert a newly available worker about a job that has already closed.
    await schema.db.job.update({ where: { id: result.jobId }, data: { status: "CANCELLED" } });
    await schema.db.workerProfile.update({ where: { userId: workers[2].userId }, data: { available: true } });
    expect(await postJob(schema.db, customer, {}, key, { now: () => now })).toEqual(result);
    expect(await schema.db.notification.count({ where: { userId: workers[2].userId, type: "job.posted" } })).toBe(0);
  });

  it("requires current licences for restricted trades and waits for an address with coordinates", async () => {
    const customer = await person(); const office = await person("ADMIN");
    const workers = await Promise.all([person("TRADIE"), person("TRADIE"), person("TRADIE")]);
    for (let i = 0; i < workers.length; i++) {
      await schema.db.workerTrade.create({ data: { userId: workers[i].userId, trade: "ELECTRICAL" } });
      await schema.db.workerProfile.create({ data: { userId: workers[i].userId, available: true, areaLat: -46.4132, areaLng: 168.3538, areaRadiusKm: 25 } });
      await schema.db.licence.create({ data: { userId: workers[i].userId, trade: "ELECTRICAL", number: `EW${i}TEST`, status: i === 1 ? "PENDING" : "VERIFIED", checkedAt: i === 1 ? null : now, checkedById: i === 1 ? null : office.userId, expiresOn: i === 2 ? new Date("2026-11-02") : null } });
    }
    const key = randomUUID(); const data = { ...input(customer, key), category: "ELECTRICAL" };
    const result = await postJob(schema.db, customer, data, key, { now: () => now, photoExists: async () => true, rateLimit: async () => ({ allowed: true }) });
    expect(result.status).toBe("posted"); if (result.status !== "posted") return;
    const rows = await schema.db.notification.findMany({ where: { payload: { path: ["jobId"], equals: result.jobId } } });
    expect(rows.map((r) => r.userId)).toEqual([workers[0].userId]);
    const typedKey = randomUUID();
    const typed = await postJob(schema.db, customer, { ...input(customer, typedKey), category: "ELECTRICAL", locationSource: "TYPED", point: undefined }, typedKey, { now: () => now, photoExists: async () => true, rateLimit: async () => ({ allowed: true }) });
    expect(typed.status).toBe("posted"); if (typed.status !== "posted") return;
    const job = await schema.db.job.findUniqueOrThrow({ where: { id: typed.jobId } });
    expect(job).toMatchObject({ locationNeedsCheck: true, coverage: "CHECK_LATER" });
    expect(await schema.db.notification.count({ where: { payload: { path: ["jobId"], equals: typed.jobId } } })).toBe(0);
  });
});
