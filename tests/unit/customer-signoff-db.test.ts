import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { loadCustomerSignoff, signOffJob } from "@/server/jobs/customer-signoff";
import { priceJob } from "@/server/pricing/price-job";
import { runScheduledRules } from "@/server/scheduler/runner";
import { SCHEDULER_RULES } from "@/server/scheduler/rules";
import { testDatabaseUrl, useTestSchema } from "../support/test-db";

describe.skipIf(!testDatabaseUrl)("customer sign-off transactions", () => {
  const schema = useTestSchema("customer-signoff-db");
  async function person(role: "CUSTOMER" | "TRADIE" | "ADMIN" = "CUSTOMER") {
    const id = randomUUID(); await schema.db.$executeRawUnsafe("INSERT INTO auth.users (id) VALUES ($1::uuid)", id);
    await schema.db.profile.create({ data: { id, email: `${id}@example.nz`, role, firstName: "Example" } });
    return { userId: id, role };
  }
  async function fixture() {
    const customer = await person(), worker = await person("TRADIE");
    const initial = await schema.db.job.create({ data: { customerId: customer.userId, category: "OTHER", status: "REVIEW", title: "Hang a door", description: "Interior door", addressLine1: "1 Example Street", suburb: "Windsor", city: "Invercargill" } });
    expect(await priceJob(schema.db, { jobId: initial.id, minutes: 60, materialsCents: 0 })).toMatchObject({ ok: true });
    const job = await schema.db.job.update({ where: { id: initial.id }, data: { status: "SUBMITTED", workerId: worker.userId } });
    return { customer, worker, job, revision: job.updatedAt.toISOString() };
  }
  async function evidence(jobId: string, workerId: string, cocPath = "documents/private-coc.pdf") {
    await schema.db.jobMaterials.create({ data: { jobId, budgetCents: 0, spentCents: 0, spentAt: new Date() } });
    await schema.db.completionEvidence.create({ data: { jobId, workerId, cocNumber: "2026-118734", cocPath, notes: "All done.", declaration: "I did this work and it is safe and complete.", declaredAt: new Date() } });
    await schema.db.completionEvidencePhoto.create({ data: { jobId, path: `evidence/${jobId}/private.webp` } });
    return schema.db.completionEvidence.update({ where: { jobId }, data: { submittedAt: new Date() } });
  }
  it("completes through the machine, notifies the worker and queues the existing payout without a review", async () => {
    const { customer, worker, job, revision } = await fixture();
    expect(await signOffJob(schema.db, customer, job.id, revision)).toEqual({ status: "signed-off" });
    expect(await schema.db.job.findUnique({ where: { id: job.id } })).toMatchObject({ status: "COMPLETED" });
    expect(await schema.db.payout.findMany({ where: { jobId: job.id } })).toMatchObject([{ workerId: worker.userId, status: "QUEUED" }]);
    expect(await schema.db.notification.findMany({ where: { userId: worker.userId, type: "job.signed_off" } })).toHaveLength(1);
    expect(await schema.db.auditLog.findMany({ where: { recordId: job.id, action: "job.completed" } })).toHaveLength(1);
    expect(await schema.db.review.count({ where: { jobId: job.id } })).toBe(0);
  });
  it("two concurrent sign-offs save exactly one optional review, audit and payout", async () => {
    const { customer, worker, job, revision } = await fixture(), review = { rating: 5, tags: ["On time", "Tidy"], comment: "All sorted." };
    const results = await Promise.all([signOffJob(schema.db, customer, job.id, revision, review), signOffJob(schema.db, customer, job.id, revision, review)]);
    expect(results.map(result => result.status).sort()).toEqual(["changed", "signed-off"]);
    expect(await schema.db.review.findMany({ where: { jobId: job.id } })).toMatchObject([{ reviewerId: customer.userId, workerId: worker.userId, rating: 5, tags: review.tags, comment: review.comment }]);
    expect(await schema.db.auditLog.count({ where: { action: "review.posted", recordType: "reviews", actorId: customer.userId } })).toBe(1);
    expect(await schema.db.payout.count({ where: { jobId: job.id } })).toBe(1);
    expect(await schema.db.notification.count({ where: { userId: worker.userId, type: "job.signed_off", payload: { path: ["jobId"], equals: job.id } } })).toBe(1);
  });
  it("refuses another customer or changed real role and returns changed for a stale revision or status", async () => {
    const { customer, job, revision } = await fixture(), other = await person();
    expect(await signOffJob(schema.db, other, job.id, revision)).toEqual({ status: "forbidden" });
    expect(await signOffJob(schema.db, customer, job.id, "old")).toEqual({ status: "changed" });
    await schema.db.profile.update({ where: { id: customer.userId }, data: { role: "TRADIE" } });
    expect(await signOffJob(schema.db, customer, job.id, revision)).toEqual({ status: "forbidden" });
    await schema.db.profile.update({ where: { id: customer.userId }, data: { role: "CUSTOMER" } });
    await schema.db.job.update({ where: { id: job.id }, data: { status: "ASSIGNED" } });
    expect(await signOffJob(schema.db, customer, job.id, revision)).toEqual({ status: "changed" });
    expect(await schema.db.payout.count({ where: { jobId: job.id } })).toBe(0);
  });
  it("validates rating, the four tags and the 1000-character comment before any write", async () => {
    const { customer, job, revision } = await fixture();
    for (const review of [{ rating: 0, tags: [] }, { rating: 2.5, tags: [] }, { rating: 6, tags: [] }, { rating: 4, tags: ["Other"] }, { rating: 4, tags: [], comment: "x".repeat(1001) }]) expect(await signOffJob(schema.db, customer, job.id, revision, review)).toEqual({ status: "invalid" });
    expect(await schema.db.job.findUnique({ where: { id: job.id } })).toMatchObject({ status: "SUBMITTED" });
  });
  it("never signs evidence for a foreign customer or a changed actual role", async () => {
    const { customer, worker, job } = await fixture(), other = await person(), sign = vi.fn(async () => "signed");
    await evidence(job.id, worker.userId);
    expect(await loadCustomerSignoff(schema.db, other, job.id, sign)).toBeNull();
    await schema.db.profile.update({ where: { id: customer.userId }, data: { role: "TRADIE" } });
    expect(await loadCustomerSignoff(schema.db, customer, job.id, sign)).toBeNull();
    expect(sign).not.toHaveBeenCalled();
  });
  it("signs only authorized submitted evidence with the correct buckets and keeps non-file data on signing failure", async () => {
    const { customer, worker, job } = await fixture(); const sent = await evidence(job.id, worker.userId);
    const sign = vi.fn(async (bucket: string, path: string) => `https://storage.example.test/${bucket}/${path}?signed`);
    const now = new Date(sent.submittedAt!.getTime() + 2 * 3_600_000);
    await schema.db.settings.update({ where: { id: 1 }, data: { autoReleaseHours: 72 } });
    const data = await loadCustomerSignoff(schema.db, customer, job.id, sign, now);
    expect(data).toMatchObject({ cocNumber: "2026-118734", cocFileLabel: "PDF", notes: "All done.", autoReleaseHours: 72, hoursLeft: 70, problemOpen: false, autoCompleted: false, filesUnavailable: false });
    expect(sign.mock.calls).toContainEqual(["documents", "documents/private-coc.pdf"]);
    expect(sign.mock.calls).toContainEqual(["photos", `evidence/${job.id}/private.webp`]);
    expect(Object.keys(data!)).not.toContain("cocPath"); expect(Object.keys(data!.photos[0])).toEqual(["id", "url"]);
    const failed = await loadCustomerSignoff(schema.db, customer, job.id, async () => { throw new Error("storage unavailable"); }, now);
    expect(failed).toMatchObject({ cocNumber: "2026-118734", cocUrl: null, notes: "All done.", photos: [{ url: null }], filesUnavailable: true });
    expect(JSON.stringify(failed)).not.toContain("private");
    await schema.db.settings.update({ where: { id: 1 }, data: { autoReleaseHours: 48 } });
  });
  it("the existing timer completes and tells the customer; an open report pauses it", async () => {
    const { customer, worker, job } = await fixture(); const sent = await evidence(job.id, worker.userId);
    const rules = SCHEDULER_RULES.filter(rule => rule.name === "auto-sign-off"), now = new Date(sent.submittedAt!.getTime() + 49 * 3_600_000);
    const report = await schema.db.problemReport.create({ data: { jobId: job.id, reportedById: customer.userId, topic: "Other", details: "Please check this work." } });
    expect((await loadCustomerSignoff(schema.db, customer, job.id, async () => "signed"))?.problemOpen).toBe(true);
    await runScheduledRules(schema.db, { now, rules });
    expect((await schema.db.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("SUBMITTED");
    const office = await person("ADMIN");
    await schema.db.problemReport.update({ where: { id: report.id }, data: { status: "RESOLVED", resolvedAt: new Date(), resolvedById: office.userId, resolution: "Fixture resolved." } });
    await runScheduledRules(schema.db, { now, rules });
    expect(await loadCustomerSignoff(schema.db, customer, job.id, async () => "signed", now)).toMatchObject({ autoCompleted: true, problemOpen: false });
    expect(await schema.db.notification.count({ where: { userId: customer.userId, type: "job.auto_completed", payload: { path: ["jobId"], equals: job.id } } })).toBe(1);
    expect(await schema.db.payout.count({ where: { jobId: job.id } })).toBe(1);
  });
  it("manual customer completion is not labelled as automatic", async () => {
    const { customer, worker, job, revision } = await fixture(); await evidence(job.id, worker.userId);
    expect(await signOffJob(schema.db, customer, job.id, revision)).toEqual({ status: "signed-off" });
    expect((await loadCustomerSignoff(schema.db, customer, job.id, async () => "signed"))?.autoCompleted).toBe(false);
  });
  it("preserves automatic-completion history when the current deadline setting changes", async () => {
    const { customer, worker, job } = await fixture(); const sent = await evidence(job.id, worker.userId);
    const now = new Date(sent.submittedAt!.getTime() + 2 * 3_600_000);
    await schema.db.settings.update({ where: { id: 1 }, data: { autoReleaseHours: 1 } });
    expect(await loadCustomerSignoff(schema.db, customer, job.id, async () => "signed", now)).toMatchObject({ autoReleaseHours: 1, hoursLeft: 0, releaseAt: new Date(sent.submittedAt!.getTime() + 3_600_000).toISOString(), autoCompleted: false });
    await runScheduledRules(schema.db, { now, rules: SCHEDULER_RULES.filter(rule => rule.name === "auto-sign-off") });
    await schema.db.settings.update({ where: { id: 1 }, data: { autoReleaseHours: 72 } });
    expect(await loadCustomerSignoff(schema.db, customer, job.id, async () => "signed", now)).toMatchObject({ autoReleaseHours: 72, autoCompleted: true });
    await schema.db.settings.update({ where: { id: 1 }, data: { autoReleaseHours: 48 } });
  });
  it.each([["coc/worker/certificate.webp", "Photo"], ["coc/legacy-document", "File"]])("labels existing CoC metadata %s without returning its private path", async (path, label) => {
    const { customer, worker, job } = await fixture(); await evidence(job.id, worker.userId, path);
    const data = await loadCustomerSignoff(schema.db, customer, job.id, async () => "https://example.test/signed");
    expect(data?.cocFileLabel).toBe(label); expect(JSON.stringify(data)).not.toContain(path);
  });
  it("never pairs a stale job worker with a replacement's evidence or the old worker's evidence with a replacement", async () => {
    const { customer, worker, job } = await fixture(); await evidence(job.id, worker.userId);
    const replacement = await person("TRADIE"), sign = vi.fn(async () => "signed");
    await schema.db.job.update({ where: { id: job.id }, data: { workerId: replacement.userId } });
    expect(await loadCustomerSignoff(schema.db, customer, job.id, sign, undefined, worker.userId)).toBeNull();
    expect(await loadCustomerSignoff(schema.db, customer, job.id, sign, undefined, replacement.userId)).toMatchObject({ cocUrl: null, photos: [], notes: null });
    expect(sign).not.toHaveBeenCalled();
  });
});
