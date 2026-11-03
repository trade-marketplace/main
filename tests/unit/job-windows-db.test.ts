import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { JobStatus, Role } from "@/generated/prisma/client";
import type { Viewer } from "@/server/auth/viewer";
import { loadJobWindows, saveJobWindows, WINDOWS_EXPIRED_RULE } from "@/server/jobs/windows";
import { transitionJob } from "@/server/jobs/status-machine";
import { windowExpiry } from "@/server/scheduler/window-expiry";
import { inboxItem } from "@/server/notifications/inbox";
import { loadDraft, saveDraft } from "@/server/jobs/drafts";
import { canonicalDraft, editWhere, initialWizardDraft } from "@/lib/post-job-wizard";
import { testDatabaseUrl, useTestSchema } from "../support/test-db";

describe.skipIf(!testDatabaseUrl)("owned time-window refresh and expiry (database)", () => {
  const schema = useTestSchema(import.meta.filename); const now = new Date("2026-11-04T00:00:00Z");
  const fresh = { anyTime: false, asap: true, timeWindows: [{ date: "2026-11-04", timeOfDay: "MORNING" as const }] };
  async function person(role: Role = "CUSTOMER"): Promise<Viewer> {
    const id = randomUUID(); await schema.db.$executeRaw`INSERT INTO auth.users (id) VALUES (${id}::uuid)`;
    await schema.db.profile.create({ data: { id, email: `${id}@example.nz`, firstName: "Test", role } });
    return { userId: id, email: `${id}@example.nz`, firstName: "Test", role, emailVerified: true };
  }
  async function job(dates = ["2026-11-03"], anyTime = false, status: JobStatus = "BOOKABLE") {
    const customer = await person();
    const row = await schema.db.job.create({ data: { customerId: customer.userId, category: "OTHER", title: "Hang a door", description: "Interior door, frame is fine.", addressLine1: "1 Example St", suburb: "Gladstone", city: "Invercargill", status, priceCents: 12000, anyTime,
      timeWindows: { create: dates.map(date => ({ date: new Date(`${date}T00:00:00Z`), timeOfDay: "MORNING" as const })) } } });
    return { ...row, customer };
  }
  const load = async (row: Awaited<ReturnType<typeof job>>) => (await loadJobWindows(schema.db, row.customer, row.id))!;
  const run = () => windowExpiry.run({ db: schema.db, now, limit: 200 });
  const notices = (id: string) => schema.db.notification.findMany({ where: { type: "job.reschedule_requested", payload: { path: ["jobId"], equals: id } } });
  const updatedAt = async (id: string) => (await schema.db.job.findUniqueOrThrow({ where: { id } })).updatedAt;
  const claim = async (id: string) => transitionJob(schema.db, { audit: async () => {}, notify: async () => {} }, { jobId: id, transition: "claim", actor: { role: "TRADIE", userId: (await person("TRADIE")).userId }, now });

  it("saves only schedule fields, preserving pricing, status, ownership and the quote snapshot", async () => {
    const row = await job(["2026-11-03"], false, "PRICED");
    const pricing = await schema.db.jobPricing.create({ data: { jobId: row.id, workerRateCents: 7000, minMinutes: 120, holidayPayBps: 800, onCostBps: 1250, marginBps: 2000, gstBps: 1500, minutes: 120, materialsCents: 1500, workerGrossCents: 14000, holidayPayCents: 1120, onCostCents: 1890, marginCents: 3702, gstCents: 3032 } });
    await schema.db.job.update({ where: { id: row.id }, data: { status: "BOOKABLE" } });
    const before = await load(row);
    const result = await saveJobWindows(schema.db, row.customer, row.id, fresh, before.revision, now);
    expect(result.status).toBe("saved");
    expect(await schema.db.job.findUnique({ where: { id: row.id } })).toMatchObject({ customerId: row.customerId, status: "BOOKABLE", priceCents: 12000, asap: true, workerId: null });
    expect(await schema.db.jobPricing.findUnique({ where: { jobId: row.id } })).toEqual(pricing);
    expect(await schema.db.auditLog.count({ where: { recordId: row.id, action: "job.windows_updated" } })).toBe(1);
  });
  it("does not expose foreign jobs, accept other roles or trust a stale customer role", async () => {
    const row = await job(); const before = await load(row); const other = await person();
    expect(await loadJobWindows(schema.db, other, row.id)).toBeNull();
    expect(await saveJobWindows(schema.db, other, row.id, fresh, before.revision, now)).toEqual({ status: "forbidden" });
    expect(await updatedAt(row.id)).toEqual(row.updatedAt);
    expect(await loadJobWindows(schema.db, await person("TRADIE"), row.id)).toBeNull();
    await schema.db.profile.update({ where: { id: row.customerId }, data: { role: "TRADIE" } });
    expect(await saveJobWindows(schema.db, row.customer, row.id, fresh, before.revision, now)).toEqual({ status: "forbidden" });
  });
  it("refuses past, duplicate, empty and forged non-schedule fields", async () => {
    const row = await job(); const before = await load(row);
    for (const input of [{ ...fresh, priceCents: 1 }, { ...fresh, timeWindows: [] }, { ...fresh, timeWindows: [fresh.timeWindows[0], fresh.timeWindows[0]] }, { ...fresh, timeWindows: [{ date: "2026-11-03", timeOfDay: "MORNING" }] }]) {
      expect((await saveJobWindows(schema.db, row.customer, row.id, input, before.revision, now)).status).toBe("invalid");
    }
    expect((await load(row)).revision).toBe(before.revision);
  });
  it("allows only one concurrent revision and returns current values to the other device", async () => {
    const row = await job(); const before = await load(row);
    const results = await Promise.all([fresh, { ...fresh, asap: false }].map(input => saveJobWindows(schema.db, row.customer, row.id, input, before.revision, now)));
    expect(results.map(result => result.status).sort()).toEqual(["changed", "saved"]);
    const changed = results.find(result => result.status === "changed")!;
    expect(changed).toMatchObject({ snapshot: { revision: (await load(row)).revision } });
    const afterEdit = await updatedAt(row.id);
    expect((await saveJobWindows(schema.db, row.customer, row.id, fresh, before.revision, now)).status).toBe("changed");
    expect(await updatedAt(row.id)).toEqual(afterEdit);
  });
  it("does not edit a job that was claimed or left BOOKABLE after the page loaded", async () => {
    const row = await job(["2026-11-04"]); const before = await load(row); await claim(row.id);
    expect(await saveJobWindows(schema.db, row.customer, row.id, fresh, before.revision, now)).toMatchObject({ status: "changed", snapshot: { editable: false } });
    expect((await load(row)).schedule.asap).toBe(false);
  });
  it("blocks a dated expired claim but permits every same-day part, Any time and legacy empty schedules", async () => {
    const expired = await job(); await expect(claim(expired.id)).rejects.toMatchObject({ failure: "time-windows-expired" });
    for (const [dates, anytime] of [[["2026-11-04"], false], [["2026-11-03"], true], [[], false]] as const) {
      const row = await job([...dates], anytime); expect((await claim(row.id)).to).toBe("ASSIGNED");
    }
  });
  it("atomically sends one owned refresh link per window set, including simultaneous runs", async () => {
    const row = await job(); await Promise.all([run(), run()]);
    const rows = await notices(row.id); expect(rows).toHaveLength(1);
    expect(inboxItem(rows[0])).toMatchObject({ line: "New time requested", href: `/jobs/${row.id}/windows` });
    expect(await schema.db.scheduledJobMark.count({ where: { jobId: row.id, rule: WINDOWS_EXPIRED_RULE } })).toBe(1);
    expect((await schema.db.job.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("BOOKABLE");
    expect(await updatedAt(row.id)).toEqual(row.updatedAt);
  });
  it("leaves Any time, empty, partially future and non-BOOKABLE jobs unmarked", async () => {
    const rows = await Promise.all([job(["2026-11-03"], true), job([]), job(["2026-11-03", "2026-11-04"]), job(["2026-11-03"], false, "PRICED")]);
    await run(); for (const row of rows) expect(await notices(row.id)).toHaveLength(0);
  });
  it("clears the expired mark after an owned update and can notify a later, different expired set", async () => {
    const row = await job(); await run(); const before = await load(row);
    await saveJobWindows(schema.db, row.customer, row.id, fresh, before.revision, now);
    expect(await schema.db.scheduledJobMark.count({ where: { jobId: row.id, rule: WINDOWS_EXPIRED_RULE } })).toBe(0);
    expect((await claim(row.id)).to).toBe("ASSIGNED");
    const second = await job(); await run(); const initial = await load(second);
    await saveJobWindows(schema.db, second.customer, second.id, fresh, initial.revision, now);
    await windowExpiry.run({ db: schema.db, now: new Date("2026-11-05T00:00:00Z"), limit: 200 });
    expect(await notices(second.id)).toHaveLength(2);
  });
  it("rechecks status and the current schedule after its candidate lookup", async () => {
    const row = await job(); const before = await load(row);
    const candidates = await schema.db.job.findMany({ where: { id: row.id } });
    await saveJobWindows(schema.db, row.customer, row.id, fresh, before.revision, now);
    const afterEdit = await updatedAt(row.id);
    // Return the candidate lookup that completed just before the customer's update.
    const spy = vi.spyOn(schema.db.job, "findMany").mockResolvedValueOnce(candidates);
    try { await run(); } finally { spy.mockRestore(); }
    expect(await notices(row.id)).toHaveLength(0);
    expect(await updatedAt(row.id)).toEqual(afterEdit);
  });
  it("rolls back a failed reminder mark and retries delivery on the next run", async () => {
    const row = await job(); const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await schema.db.$executeRawUnsafe(`CREATE FUNCTION "${schema.name}".reject_windows_notice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.type = 'job.reschedule_requested' THEN RAISE EXCEPTION 'test notice failure'; END IF; RETURN NEW; END $$`);
    await schema.db.$executeRawUnsafe(`CREATE TRIGGER reject_windows_notice BEFORE INSERT ON "${schema.name}".notifications FOR EACH ROW EXECUTE FUNCTION "${schema.name}".reject_windows_notice()`);
    try { expect((await run()).failed).toBeGreaterThan(0); }
    finally { await schema.db.$executeRawUnsafe(`DROP TRIGGER reject_windows_notice ON "${schema.name}".notifications`); log.mockRestore(); }
    expect(await schema.db.scheduledJobMark.count({ where: { jobId: row.id, rule: WINDOWS_EXPIRED_RULE } })).toBe(0);
    await run(); expect(await notices(row.id)).toHaveLength(1);
  });
  it("keeps the extended marker table server-only with RLS and revoked browser grants", async () => {
    const result = await schema.db.$queryRaw<{ enabled: boolean; policies: bigint }[]>`SELECT c.relrowsecurity AS enabled, (SELECT count(*) FROM pg_policy p WHERE p.polrelid=c.oid) AS policies FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=${schema.name} AND c.relname='scheduled_job_marks'`;
    expect(result).toEqual([{ enabled: true, policies: 0n }]);
  });
  it("full wizard saves clear a postcode on another-device restore while photo-only patches preserve fields", async () => {
    const customer = await person(); const key = randomUUID();
    const input = { postKey: key, description: "Check the upstairs lights", category: "ELECTRICAL" as const, addressLine1: "1 Example St", suburb: "Gladstone", city: "Invercargill", postcode: "9810", photoPaths: [] };
    await saveDraft(schema.db, customer, input);
    const cleared = canonicalDraft(editWhere(initialWizardDraft(input), { postcode: "" }));
    expect(await saveDraft(schema.db, customer, cleared, { fullSnapshot: true, expectedPostKey: key, expectedPhotoPaths: [] })).toEqual({ status: "saved" });
    expect((await loadDraft(schema.db, customer))?.postcode).toBeUndefined();
    await saveDraft(schema.db, customer, { postcode: "9810" });
    const newAddress = canonicalDraft(editWhere(initialWizardDraft((await loadDraft(schema.db, customer))!), { addressLine1: "2 New Street", postcode: "" }));
    await saveDraft(schema.db, customer, newAddress, { fullSnapshot: true, expectedPostKey: key, expectedPhotoPaths: [] });
    expect(await loadDraft(schema.db, customer)).toMatchObject({ addressLine1: "2 New Street" }); expect((await loadDraft(schema.db, customer))?.postcode).toBeUndefined();
    await saveDraft(schema.db, customer, { photoPaths: [] }, { expectedPostKey: key, expectedPhotoPaths: [] });
    expect((await loadDraft(schema.db, customer))?.addressLine1).toBe("2 New Street");
  });
});
