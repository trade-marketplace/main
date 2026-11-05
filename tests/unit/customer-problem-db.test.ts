import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/generated/prisma/client";
import { loadCustomerProblem, reportCustomerProblem } from "@/server/jobs/customer-problem";
import { applyTransition, transitionJob, type StatusMachineDeps } from "@/server/jobs/status-machine";
import { getMessages } from "@/server/messages/service";
import { getOfficeJob } from "@/server/office/job";
import { supportPhotoCleanup, SUPPORT_PHOTO_GRACE_MS } from "@/server/messages/photo-cleanup";
import { inboxItem } from "@/server/notifications/inbox";
import { readOfficeQueues } from "@/server/office/queues";
import { parseQueueQuery } from "@/lib/office-queues";
import { priceJob } from "@/server/pricing/price-job";
import { loadOfficeProblemReport } from "@/server/office/problem-report";
import { testDatabaseUrl, useTestSchema } from "../support/test-db";

describe.skipIf(!testDatabaseUrl)("customer problem reports (database)", () => {
  const schema = useTestSchema(import.meta.filename);
  const deps = { rateLimit: async () => ({ allowed: true } as const) };
  const transitions: StatusMachineDeps = { audit: async () => {}, notify: async () => {} };
  afterEach(async () => { await schema.db.profile.updateMany({ where: { role: "ADMIN" }, data: { role: "CUSTOMER" } }); });
  async function person(role: Role = "CUSTOMER") {
    const id = randomUUID(); await schema.db.$executeRaw`INSERT INTO auth.users(id) VALUES(${id}::uuid)`;
    await schema.db.profile.create({ data: { id, email: `${id}@example.test`, firstName: "Report fixture", role } });
    return { userId: id };
  }
  async function fixture() {
    const customer = await person(), worker = await person("TRADIE"), office = await person("ADMIN"), stranger = await person();
    const job = await schema.db.job.create({ data: { customerId: customer.userId, category: "OTHER", title: "Replace a switch", description: "Switch is loose", addressLine1: "1 Fixture Street", suburb: "Windsor", city: "Invercargill", status: "REVIEW" } });
    expect((await priceJob(schema.db, { jobId: job.id, minutes: 120, materialsCents: 0, pricedById: office.userId })).ok).toBe(true);
    await schema.db.job.update({ where: { id: job.id }, data: { status: "ASSIGNED", workerId: worker.userId } });
    await schema.db.jobMaterials.create({ data: { jobId: job.id, budgetCents: 0, spentCents: 0, spentAt: new Date() } });
    await schema.db.completionEvidence.create({ data: { jobId: job.id, workerId: worker.userId, notes: "Switch replaced" } });
    await schema.db.completionEvidencePhoto.create({ data: { jobId: job.id, path: `evidence/${job.id}/switch.webp` } });
    await schema.db.completionEvidence.update({ where: { jobId: job.id }, data: { declaration: "I did this work.", declaredAt: new Date(), submittedAt: new Date() } });
    await schema.db.job.update({ where: { id: job.id }, data: { status: "SUBMITTED" } });
    return { customer, worker, office, stranger, job };
  }
  const input = (jobId: string) => ({ jobId, topic: "Work not finished", details: "The light switch is still loose.", urgent: false, photoPaths: [] as string[], requestKey: randomUUID() });
  it("atomically opens the actual hold, private office thread, audit and urgent notification; retries exactly once", async () => {
    const f = await fixture(), data = { ...input(f.job.id), urgent: true };
    const [first, retry] = await Promise.all([reportCustomerProblem(schema.db, f.customer, data, deps), reportCustomerProblem(schema.db, f.customer, data, deps)]);
    expect(first).toEqual(retry); if (!first.ok) throw new Error(first.error);
    expect(first.report.releasePaused).toBe(true);
    const report = await schema.db.problemReport.findUniqueOrThrow({ where: { id: first.report.id }, include: { supportThread: { include: { messages: true } } } });
    expect(report).toMatchObject({ status: "OPEN", urgent: true, reportedById: f.customer.userId, supportThread: { jobParticipants: false, userId: f.customer.userId, jobId: f.job.id, subject: "Urgent · Work not finished" } });
    expect(report.supportThread?.messages).toHaveLength(1);
    expect(await schema.db.auditLog.count({ where: { recordId: report.id, action: "problem_report.created" } })).toBe(1);
    const notice = await schema.db.notification.findFirstOrThrow({ where: { userId: f.office.userId, type: "problem_report.created" } });
    expect(notice.payload).toMatchObject({ reportId: report.id, urgent: true });
    expect(inboxItem(notice)).toMatchObject({ line: "Urgent problem report" });
    expect(new URL(inboxItem(notice).href, "https://app.test").searchParams.get("problem")).toBe(report.id);
    const queues = await readOfficeQueues(schema.db, { ...f.office, role: "ADMIN" }, parseQueueQuery({}));
    expect(queues.problems[0]).toMatchObject({ id: report.id, topic: "Urgent · Work not finished" });
    expect(new URL(queues.problems[0].href, "https://app.test").searchParams.get("problem")).toBe(report.id);
    expect(await schema.db.notification.count({ where: { type: "problem_report.created", userId: { in: [f.customer.userId, f.worker.userId, f.stranger.userId] } } })).toBe(0);
    await expect(transitionJob(schema.db, transitions, { jobId: f.job.id, transition: "auto-sign-off", actor: { role: "SYSTEM", source: "test" }, now: new Date(Date.now() + 49 * 3600000) })).rejects.toMatchObject({ failure: "problem-open" });
    expect(await schema.db.payout.count({ where: { jobId: f.job.id } })).toBe(0);
    expect(await reportCustomerProblem(schema.db, f.customer, { ...data, details: "Changed retry" }, deps)).toEqual({ ok: false, error: "invalid" });
    expect((await reportCustomerProblem(schema.db, f.customer, input(f.job.id), deps)).ok).toBe(true); // A separate report is never silently discarded.
  });
  it("checks current owner and role on reads/writes and never exposes a private report to the tradie", async () => {
    const f = await fixture();
    for (const actor of [f.stranger, f.worker, f.office]) {
      expect(await reportCustomerProblem(schema.db, actor, input(f.job.id), deps)).toEqual({ ok: false, error: "forbidden" });
      expect(await loadCustomerProblem(schema.db, actor, f.job.id)).toBeNull();
    }
    const result = await reportCustomerProblem(schema.db, f.customer, input(f.job.id), deps); if (!result.ok) throw new Error(result.error);
    const thread = await schema.db.supportThread.findUniqueOrThrow({ where: { problemReportId: result.report.id } });
    expect((await getMessages(schema.db, f.worker)).threads).toHaveLength(0);
    await expect(getMessages(schema.db, f.worker, thread.id)).rejects.toMatchObject({ code: "forbidden" });
    expect((await loadCustomerProblem(schema.db, f.customer, f.job.id, result.report.id))?.report).toEqual(result.report);
    expect(await loadCustomerProblem(schema.db, f.stranger, f.job.id, result.report.id)).toBeNull();
    expect(await loadCustomerProblem(schema.db, f.customer, f.job.id, randomUUID())).toBeNull();
  });
  it("returns the persisted receipt before consuming rate allowance, but rejects new and changed requests", async () => {
    const f = await fixture(), data = input(f.job.id);
    const rateLimit = vi.fn().mockResolvedValueOnce({ allowed: true }).mockResolvedValue({ allowed: false, retryAfter: 600 });
    const saved = await reportCustomerProblem(schema.db, f.customer, data, { rateLimit });
    expect(saved.ok).toBe(true);
    expect(await reportCustomerProblem(schema.db, f.customer, data, { rateLimit })).toEqual(saved);
    expect(rateLimit).toHaveBeenCalledTimes(1);
    expect(await reportCustomerProblem(schema.db, f.customer, { ...data, details: "Changed retry" }, { rateLimit })).toEqual({ ok: false, error: "invalid" });
    expect(await reportCustomerProblem(schema.db, f.stranger, data, { rateLimit })).toEqual({ ok: false, error: "forbidden" });
    expect(rateLimit).toHaveBeenCalledTimes(1);
    expect(await reportCustomerProblem(schema.db, f.customer, input(f.job.id), { rateLimit })).toEqual({ ok: false, error: "try-later", retryAfter: 600 });
    expect(await schema.db.problemReport.count({ where: { jobId: f.job.id } })).toBe(1);
  });
  it("returns the first receipt when an in-flight duplicate consumes the last allowance before the first commit", async () => {
    const f = await fixture(), data = input(f.job.id); let entered!: () => void, release!: () => void;
    const held = new Promise<void>(resolve => { entered = resolve; }), proceed = new Promise<void>(resolve => { release = resolve; });
    const rateLimit = vi.fn().mockResolvedValueOnce({ allowed: true }).mockResolvedValue({ allowed: false, retryAfter: 600 });
    const first = reportCustomerProblem(schema.db, f.customer, data, { rateLimit, notify: async () => { entered(); await proceed; } });
    await held;
    const retry = reportCustomerProblem(schema.db, f.customer, data, { rateLimit });
    try { await vi.waitFor(() => expect(rateLimit).toHaveBeenCalledTimes(2)); }
    finally { release(); }
    const saved = await first; expect(saved.ok).toBe(true); expect(await retry).toEqual(saved);
    expect(await schema.db.problemReport.count({ where: { jobId: f.job.id } })).toBe(1);
  });
  it("rolls back the hold and all report data when notification persistence fails", async () => {
    const f = await fixture(); vi.spyOn(console, "error").mockImplementation(() => {});
    try { expect(await reportCustomerProblem(schema.db, f.customer, input(f.job.id), { ...deps, notify: async () => { throw new Error("offline provider"); } })).toEqual({ ok: false, error: "unavailable" }); }
    finally { vi.restoreAllMocks(); }
    expect(await schema.db.problemReport.count({ where: { jobId: f.job.id } })).toBe(0);
    expect(await schema.db.supportThread.count({ where: { jobId: f.job.id } })).toBe(0);
  });
  it("loads the selected canonical report and photos after its message falls outside the newest twenty; authorization stays fresh", async () => {
    const f = await fixture(), path = `support/${f.job.id}/${f.customer.userId}/${"b".repeat(32)}.webp`;
    await schema.db.supportPhotoCleanup.create({ data: { path } });
    const saved = await reportCustomerProblem(schema.db, f.customer, { ...input(f.job.id), urgent: true, photoPaths: [path] }, { ...deps, files: { exists: async () => true } });
    if (!saved.ok) throw new Error(saved.error);
    const other = await reportCustomerProblem(schema.db, f.customer, { ...input(f.job.id), details: "A different report on this same job." }, deps); expect(other.ok).toBe(true);
    const later = await schema.db.supportThread.create({ data: { jobId: f.job.id, userId: f.customer.userId, jobParticipants: true, subject: "Later job conversation" } });
    await schema.db.supportMessage.createMany({ data: Array.from({ length: 26 }, (_, index) => ({ threadId: later.id, authorId: f.customer.userId, body: `Later context ${index}`, createdAt: new Date(Date.now() + 1000 + index * 1000) })) });
    const recent = await getOfficeJob(schema.db, { ...f.office, role: "ADMIN" }, f.job.id, new Date(), async () => "https://files.test/recent");
    expect(recent?.messages).toHaveLength(20); expect(recent?.messages.some(message => message.body.includes(saved.report.details))).toBe(false);
    const sign = vi.fn(async () => "https://files.test/selected-report");
    const report = await loadOfficeProblemReport(schema.db, { ...f.office, role: "ADMIN" }, f.job.id, saved.report.id, new Date(), sign);
    expect(report).toMatchObject({ id: saved.report.id, details: saved.report.details, urgent: true, photos: [{ url: "https://files.test/selected-report" }] }); expect(sign).toHaveBeenCalledWith(path);
    sign.mockClear();
    for (const actor of [f.customer, f.worker, f.stranger]) expect(await loadOfficeProblemReport(schema.db, { ...actor, role: "ADMIN" }, f.job.id, saved.report.id, new Date(), sign)).toBeNull();
    expect(await loadOfficeProblemReport(schema.db, { ...f.office, role: "ADMIN" }, randomUUID(), saved.report.id, new Date(), sign)).toBeNull(); expect(sign).not.toHaveBeenCalled();
    expect((await loadOfficeProblemReport(schema.db, { ...f.office, role: "ADMIN" }, f.job.id, saved.report.id, new Date(), async () => { throw new Error("storage unavailable"); }))?.photos[0].url).toBeNull();
    await schema.db.profile.update({ where: { id: f.office.userId }, data: { role: "CUSTOMER" } });
    expect(await loadOfficeProblemReport(schema.db, { ...f.office, role: "ADMIN" }, f.job.id, saved.report.id, new Date(), sign)).toBeNull(); expect(sign).not.toHaveBeenCalled();
  });
  it("validates private photo ownership/existence and keeps a file until its final report/message reference is deleted", async () => {
    const f = await fixture(), path = `support/${f.job.id}/${f.customer.userId}/${"a".repeat(32)}.webp`, data = { ...input(f.job.id), photoPaths: [path] };
    const files = { exists: async () => true };
    expect(await reportCustomerProblem(schema.db, f.customer, data, { ...deps, files })).toEqual({ ok: false, error: "photos-pending" });
    await schema.db.supportPhotoCleanup.create({ data: { path } });
    expect(await reportCustomerProblem(schema.db, f.customer, { ...data, photoPaths: [path, path] }, { ...deps, files })).toEqual({ ok: false, error: "photos-pending" });
    expect(await reportCustomerProblem(schema.db, f.customer, data, { ...deps, files: { exists: async () => false } })).toEqual({ ok: false, error: "photos-pending" });
    const result = await reportCustomerProblem(schema.db, f.customer, data, { ...deps, files }); if (!result.ok) throw new Error(result.error);
    const signed = vi.fn(async () => "https://fixture.test/private-photo");
    const view = await getOfficeJob(schema.db, { ...f.office, role: "ADMIN" }, f.job.id, new Date(), signed);
    expect(view?.messages.at(-1)?.photos).toEqual([expect.objectContaining({ url: "https://fixture.test/private-photo" })]); expect(signed).toHaveBeenCalledWith(path);
    const remove = vi.fn(async () => {}), cleanup = supportPhotoCleanup(() => ({ remove })), past = new Date(Date.now() - SUPPORT_PHOTO_GRACE_MS - 1000);
    const run = async () => { await schema.db.supportPhotoCleanup.update({ where: { path }, data: { createdAt: past } }); return cleanup.run({ db: schema.db, now: new Date(), limit: 10 }); };
    expect((await run()).skipped).toBeGreaterThan(0); expect(remove).not.toHaveBeenCalled();
    await schema.db.supportMessage.deleteMany({ where: { requestKey: data.requestKey } });
    expect((await run()).skipped).toBeGreaterThan(0); expect(remove).not.toHaveBeenCalled(); // Report reference still lives.
    const reused = await reportCustomerProblem(schema.db, f.customer, { ...data, requestKey: randomUUID() }, { ...deps, files });
    expect(reused.ok).toBe(true); // A report-only reference remains valid even after cleanup removed its pending intent.
    if (!reused.ok) throw new Error(reused.error);
    await schema.db.supportMessage.deleteMany({ where: { thread: { problemReportId: reused.report.id } } });
    await schema.db.problemReportPhoto.deleteMany({ where: { reportId: reused.report.id } });
    await schema.db.problemReportPhoto.deleteMany({ where: { reportId: result.report.id } });
    expect((await run()).done).toBeGreaterThan(0); expect(remove).toHaveBeenCalledWith("photos", [path]);
  });
  it("serializes a due timer behind the in-flight report and rereads the hold before completion", async () => {
    const f = await fixture(); let entered!: () => void, release!: () => void, started!: (pid: number) => void;
    const held = new Promise<void>(resolve => { entered = resolve; }), proceed = new Promise<void>(resolve => { release = resolve; }), backend = new Promise<number>(resolve => { started = resolve; });
    const reporting = reportCustomerProblem(schema.db, f.customer, input(f.job.id), { ...deps, notify: async () => { entered(); await proceed; } });
    await held;
    const timer = schema.db.$transaction(async tx => { const [row] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`; started(row.pid); return applyTransition(tx, transitions, { jobId: f.job.id, transition: "auto-sign-off", actor: { role: "SYSTEM", source: "test" }, now: new Date(Date.now() + 49 * 3600000) }); }, { timeout: 10000 }).catch(error => error);
    const pid = await backend;
    try { await vi.waitFor(async () => { const [row] = await schema.db.$queryRaw<{ wait_event_type: string }[]>`SELECT wait_event_type FROM pg_stat_activity WHERE pid=${pid}`; expect(row.wait_event_type).toBe("Lock"); }); }
    finally { release(); }
    expect((await reporting).ok).toBe(true);
    expect(await timer).toMatchObject({ failure: "problem-open" });
    expect((await schema.db.job.findUniqueOrThrow({ where: { id: f.job.id } })).status).toBe("SUBMITTED");
    expect(await schema.db.payout.count({ where: { jobId: f.job.id } })).toBe(0);
  });
  it("records reports after completion without promising a hold or changing existing payouts", async () => {
    const f = await fixture();
    await transitionJob(schema.db, transitions, { jobId: f.job.id, transition: "sign-off", actor: { role: "CUSTOMER", userId: f.customer.userId } });
    const payout = await schema.db.payout.findFirstOrThrow({ where: { jobId: f.job.id } });
    const result = await reportCustomerProblem(schema.db, f.customer, input(f.job.id), deps); expect(result).toMatchObject({ ok: true, report: { releasePaused: false } });
    expect((await schema.db.job.findUniqueOrThrow({ where: { id: f.job.id } })).status).toBe("COMPLETED");
    expect(await schema.db.payout.findFirstOrThrow({ where: { jobId: f.job.id } })).toEqual(payout);
  });
  it("keeps report tables behind RLS without direct anon/authenticated grants", async () => {
    for (const table of ["problem_reports", "problem_report_photos"]) {
      const [row] = await schema.db.$queryRawUnsafe<{ relrowsecurity: boolean }[]>(`SELECT relrowsecurity FROM pg_class WHERE oid='"${schema.name}"."${table}"'::regclass`);
      expect(row.relrowsecurity).toBe(true);
      const roles = await schema.db.$queryRaw<{ rolname: string }[]>`SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated')`;
      for (const role of roles) {
        const [privilege] = await schema.db.$queryRawUnsafe<{ allowed: boolean }[]>(`SELECT has_table_privilege($1,'"${schema.name}"."${table}"','SELECT,INSERT,UPDATE,DELETE') AS allowed`, role.rolname);
        expect(privilege.allowed).toBe(false);
      }
    }
  });
});
