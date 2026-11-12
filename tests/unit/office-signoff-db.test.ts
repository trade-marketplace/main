import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Role, Prisma } from "@/generated/prisma/client";
import { approveEvidence, flagEvidence, loadSignoffReview } from "@/server/office/signoff";
import { saveDraft, sendForSignOff, loadFinish } from "@/server/jobs/evidence";
import { signOffJob, loadCustomerSignoff } from "@/server/jobs/customer-signoff";
import { autoSignOff } from "@/server/scheduler/rules";
import { FINISH_DECLARATION } from "@/lib/finish-job";
import { priceJob } from "@/server/pricing/price-job";
import { inboxItem } from "@/server/notifications/inbox";
import { testDatabaseUrl, useTestSchema } from "../support/test-db";
describe.skipIf(!testDatabaseUrl)("office evidence review transactions", () => {
  const schema = useTestSchema(import.meta.filename);
  async function person(role: Role) { const id = randomUUID(), email = `${id}@example.test`; await schema.db.$executeRaw`INSERT INTO auth.users(id,email) VALUES(${id}::uuid,${email})`; return schema.db.profile.create({ data: { id, email, role, firstName: role, emailVerifiedAt: new Date() } }); }
  const fields = { cocNumber: "", notes: "Work finished and checked.", spent: "0", declaration: true, reason: "" };
  async function fixture() {
    const customer = await person("CUSTOMER"), worker = await person("TRADIE"), admin = await person("ADMIN");
    const job = await schema.db.job.create({ data: { customerId: customer.id, category: "OTHER", title: "Office evidence check", description: "Fix the outdoor plug.", addressLine1: "173 Test Street", suburb: "Windsor", city: "Invercargill", anyTime: true } });
    await priceJob(schema.db, { jobId: job.id, minutes: 120, materialsCents: 0, pricedById: admin.id });
    await schema.db.job.update({ where: { id: job.id }, data: { status: "ASSIGNED", workerId: worker.id } });
    await schema.db.jobMaterials.create({ data: { jobId: job.id, budgetCents: 0, spentCents: 0, spentAt: new Date() } });
    await schema.db.tradeEvidenceRule.update({ where: { trade: "OTHER" }, data: { minPhotos: 0 } });
    const tradie = { userId: worker.id, role: "TRADIE" as const }, office = { userId: admin.id, role: "ADMIN" as const };
    expect(await sendForSignOff(schema.db, tradie, job.id, fields)).toEqual({ status: "sent" });
    const evidence = await schema.db.completionEvidence.findUniqueOrThrow({ where: { jobId: job.id } });
    return { job, customer, tradie, office, revision: evidence.updatedAt.toISOString() };
  }
  const revision = async (id: string) => (await schema.db.completionEvidence.findUniqueOrThrow({ where: { jobId: id } })).updatedAt.toISOString();
  it("approves once with a fresh office role, records the check and leaves SUBMITTED with no payout", async () => {
    const f = await fixture();
    expect(await Promise.all([approveEvidence(schema.db, f.office, f.job.id, f.revision), approveEvidence(schema.db, f.office, f.job.id, f.revision)])).toEqual([{ status: "approved" }, { status: "approved" }]);
    expect(await schema.db.completionEvidence.findUniqueOrThrow({ where: { jobId: f.job.id } })).toMatchObject({ officeCheck: "APPROVED", checkedById: f.office.userId, checkNote: null, declaration: FINISH_DECLARATION });
    expect((await schema.db.job.findUniqueOrThrow({ where: { id: f.job.id } })).status).toBe("SUBMITTED");
    expect(await schema.db.auditLog.count({ where: { recordId: f.job.id, action: "evidence.approved" } })).toBe(1);
    expect(await schema.db.payout.count({ where: { jobId: f.job.id } })).toBe(0);
  });
  it("flags in two database updates, returns to the same tradie, notifies once, and supports edit/resend with cleared check and new timer", async () => {
    const f = await fixture();
    expect(await flagEvidence(schema.db, f.office, f.job.id, f.revision, "  Check the notes and send again.  ")).toEqual({ status: "flagged" });
    expect(await schema.db.completionEvidence.findUniqueOrThrow({ where: { jobId: f.job.id } })).toMatchObject({ officeCheck: "FLAGGED", submittedAt: null, checkNote: "Check the notes and send again.", checkedById: f.office.userId });
    expect(await schema.db.job.findUniqueOrThrow({ where: { id: f.job.id } })).toMatchObject({ status: "ASSIGNED", workerId: f.tradie.userId });
    expect(await schema.db.auditLog.count({ where: { recordId: f.job.id, action: "evidence.flagged" } })).toBe(1);
    expect(await schema.db.auditLog.count({ where: { recordId: f.job.id, action: "job.status_overridden" } })).toBe(1);
    const notices = await schema.db.notification.findMany({ where: { type: "job.evidence_flagged", userId: f.tradie.userId } });
    expect(notices).toHaveLength(1); expect(inboxItem(notices[0]).href).toBe(`/jobs/${f.job.id}/complete`);
    expect((await loadFinish(schema.db, f.tradie, f.job.id))?.officeNote).toBe("Check the notes and send again.");
    const now = new Date(Date.now() + 100 * 3_600_000);
    await autoSignOff.run({ db: schema.db, now, limit: 100 } as Parameters<typeof autoSignOff.run>[0]);
    expect((await schema.db.job.findUniqueOrThrow({ where: { id: f.job.id } })).status).toBe("ASSIGNED");
    expect(await schema.db.payout.count({ where: { jobId: f.job.id } })).toBe(0);
    expect(await saveDraft(schema.db, f.tradie, f.job.id, { ...fields, notes: "Corrected notes." })).toEqual({ status: "saved" });
    expect(await sendForSignOff(schema.db, f.tradie, f.job.id, { ...fields, notes: "Corrected notes." })).toEqual({ status: "sent" });
    const sent = await schema.db.completionEvidence.findUniqueOrThrow({ where: { jobId: f.job.id } });
    expect(sent).toMatchObject({ officeCheck: null, checkNote: null, checkedById: null, checkedAt: null, notes: "Corrected notes." }); expect(sent.submittedAt).not.toBeNull();
    expect((await schema.db.job.findUniqueOrThrow({ where: { id: f.job.id } })).status).toBe("SUBMITTED");
    expect((await loadFinish(schema.db, f.tradie, f.job.id))?.officeNote).toBeNull();
  });
  it("refuses a stale revision and invalid notes without evidence, audit or notification changes", async () => {
    const f = await fixture();
    for (const note of ["", "a", "x".repeat(501)]) expect(await flagEvidence(schema.db, f.office, f.job.id, f.revision, note)).toEqual({ status: "invalid" });
    expect(await approveEvidence(schema.db, f.office, f.job.id, "old")).toEqual({ status: "changed" });
    expect(await flagEvidence(schema.db, f.office, f.job.id, "old", "Please fix this")).toEqual({ status: "changed" });
    expect(await revision(f.job.id)).toBe(f.revision);
    expect(await schema.db.auditLog.count({ where: { recordId: f.job.id, action: { in: ["evidence.approved", "evidence.flagged"] } } })).toBe(0);
  });
  it("refuses customers/tradies, forged and revoked office roles before signing files or writing", async () => {
    const f = await fixture();
    for (const viewer of [{ userId: f.customer.id, role: "CUSTOMER" as const }, f.tradie, { userId: f.customer.id, role: "ADMIN" as const }]) {
      expect(await approveEvidence(schema.db, viewer, f.job.id, f.revision)).toEqual({ status: "forbidden" });
      expect(await flagEvidence(schema.db, viewer, f.job.id, f.revision, "Fix this note")).toEqual({ status: "forbidden" });
      expect(await loadSignoffReview(schema.db, viewer, f.job.id)).toBeNull();
    }
    await schema.db.profile.update({ where: { id: f.office.userId }, data: { role: "CUSTOMER" } });
    expect(await approveEvidence(schema.db, f.office, f.job.id, f.revision)).toEqual({ status: "forbidden" });
  });
  it("rolls evidence/status/audits back if notification fails", async () => {
    const f = await fixture();
    const broken = new Proxy(schema.db, { get(target, key) { if (key !== "$transaction") return Reflect.get(target, key, target); return (run: (tx: Prisma.TransactionClient) => Promise<unknown>) => target.$transaction(tx => run(new Proxy(tx, { get(client, model) { return model === "notification" ? { upsert: () => { throw Error("Test notification failure"); } } : Reflect.get(client, model, client); } }))); } });
    expect(await flagEvidence(broken, f.office, f.job.id, f.revision, "Fix this note")).toEqual({ status: "unavailable" });
    expect((await schema.db.job.findUniqueOrThrow({ where: { id: f.job.id } })).status).toBe("SUBMITTED");
    expect(await revision(f.job.id)).toBe(f.revision);
  });
  it("keeps private paths server-side and reports failed file signing", async () => {
    const f = await fixture();
    const view = await loadSignoffReview(schema.db, f.office, f.job.id, { photos: async () => { throw Error("Private storage unavailable"); }, document: async () => ({ url: "https://files.example.test/signed" }) });
    expect(view).toMatchObject({ filesUnavailable: true, photos: [], checked: false, movedOn: false });
    expect(JSON.stringify(view)).not.toMatch(/customerId|workerId|cocPath|receiptPath|addressLine1/);
  });
  it("does not permit a stale customer sign-off after flagging", async () => {
    const f = await fixture();
    const customer = { userId: f.customer.id, role: "CUSTOMER" as const };
    const before = await loadCustomerSignoff(schema.db, customer, f.job.id);
    const beforeJob = await schema.db.job.findUniqueOrThrow({ where: { id: f.job.id } });
    const stale = { jobUpdatedAt: beforeJob.updatedAt.toISOString(), workerId: f.tradie.userId, evidenceRevision: before!.evidenceRevision };
    expect(stale.evidenceRevision).toMatch(/^[0-9a-f]{64}$/);
    expect(await flagEvidence(schema.db, f.office, f.job.id, f.revision, "Please check this")).toEqual({ status: "flagged" });
    expect(await signOffJob(schema.db, customer, f.job.id, stale)).toEqual({ status: "changed" });
    expect((await schema.db.job.findUniqueOrThrow({ where: { id: f.job.id } })).status).toBe("ASSIGNED");
    expect(await sendForSignOff(schema.db, f.tradie, f.job.id, fields)).toEqual({ status: "sent" });
    expect(await signOffJob(schema.db, customer, f.job.id, stale)).toEqual({ status: "changed" });
    expect(await schema.db.payout.count({ where: { jobId: f.job.id } })).toBe(0);
  });
});
