import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { changeWaitingJob } from "@/server/jobs/customer-waiting";
import { waitingJobRevision } from "@/lib/customer-job-waiting";
import { priceJob } from "@/server/pricing/price-job";
import { loadCustomerJobPage } from "@/server/jobs/customer-page";
import { customerJobListView, JOB_LIST_SELECT } from "@/server/views";
import { transitionJob } from "@/server/jobs/status-machine";
import { testDatabaseUrl, useTestSchema } from "../support/test-db";

describe.skipIf(!testDatabaseUrl)("customer waiting commands", () => {
  const schema = useTestSchema(import.meta.filename);
  const revision = (job: { updatedAt: Date; title: string; description: string; accessNotes: string | null }) => waitingJobRevision(job.updatedAt.toISOString(), { title: job.title, description: job.description, accessNotes: job.accessNotes ?? "" });
  async function person(role: "CUSTOMER" | "TRADIE" | "ADMIN" = "CUSTOMER") {
    const id = randomUUID(), email = `${id}@example.test`;
    await schema.db.$executeRaw`INSERT INTO auth.users(id,email) VALUES(${id}::uuid,${email})`;
    await schema.db.profile.create({ data: { id, email, role, firstName: "Customer" } });
    return { userId: id, role };
  }
  async function fixture() {
    const customer = await person(), worker = await person("TRADIE");
    const job = await schema.db.job.create({ data: { customerId: customer.userId, category: "OTHER", title: "Move a couch", description: "Move the couch upstairs.", addressLine1: "12 Example Street", suburb: "Windsor", city: "Invercargill" } });
    await schema.db.estimate.create({ data: { jobId: job.id, workerId: worker.userId, minutes: 60 } });
    return { customer, worker, job };
  }
  const input = { title: "Move two couches", description: "Move both couches upstairs.", accessNotes: "Use the side door." };
  const effects = { audit: async () => {}, notify: async () => {} };
  async function projections(customer: { userId: string; role: "CUSTOMER" | "TRADIE" | "ADMIN" }, id: string) {
    const detail = await loadCustomerJobPage(schema.db, customer, id);
    expect(detail.state).toBe("ready"); if (detail.state !== "ready") throw new Error("Owned detail must load");
    const row = await schema.db.job.findUniqueOrThrow({ where: { id }, select: JOB_LIST_SELECT });
    return { detail: detail.job, list: customerJobListView(customer, row)!, row };
  }
  it("saves details, invalidates prior quotes and notifies their authors once without forwarding private content", async () => {
    const { customer, worker, job } = await fixture();
    expect(await changeWaitingJob(schema.db, customer, job.id, revision(job), "edit", input)).toEqual({ status: "saved" });
    const saved = await schema.db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(saved).toMatchObject(input); expect(saved.editedAt).toBeInstanceOf(Date);
    expect(await schema.db.estimate.findFirst({ where: { jobId: job.id } })).toMatchObject({ madeBeforeEdit: true });
    expect(await schema.db.notification.findMany({ where: { userId: worker.userId, type: "job.details_updated" } })).toMatchObject([{ payload: { jobId: job.id, jobNumber: job.jobNumber } }]);
    expect(await changeWaitingJob(schema.db, customer, job.id, revision(job), "edit", input)).toEqual({ status: "changed" });
    expect(await changeWaitingJob(schema.db, customer, job.id, revision(saved), "edit", input)).toEqual({ status: "saved" });
    expect(await schema.db.auditLog.count({ where: { recordId: job.id, action: "job.details_updated" } })).toBe(1);
    expect(await schema.db.notification.count({ where: { userId: worker.userId, type: "job.details_updated" } })).toBe(1);
  });
  it("refuses foreign ownership, role changes, stale revision and priced jobs without changes", async () => {
    const { customer, worker, job } = await fixture(), other = await person();
    for (const actor of [worker, other]) expect(await changeWaitingJob(schema.db, actor, job.id, revision(job), "edit", input)).toEqual({ status: "forbidden" });
    expect(await changeWaitingJob(schema.db, customer, job.id, "old", "edit", input)).toEqual({ status: "changed" });
    await schema.db.job.update({ where: { id: job.id }, data: { status: "PRICED", priceCents: 10000 } });
    const priced = await schema.db.job.findUniqueOrThrow({ where: { id: job.id } });
    for (const command of ["edit", "cancel"] as const) expect(await changeWaitingJob(schema.db, customer, job.id, revision(priced), command, input)).toEqual({ status: "changed" });
    expect(await schema.db.auditLog.count({ where: { recordId: job.id } })).toBe(0);
    expect(await schema.db.job.findUnique({ where: { id: job.id } })).toMatchObject({ title: job.title, status: "PRICED", editedAt: null });
    await schema.db.profile.update({ where: { id: customer.userId }, data: { role: "TRADIE" } });
    expect(await changeWaitingJob(schema.db, customer, job.id, revision(priced), "edit", input)).toEqual({ status: "forbidden" });
  });
  it("keeps editing available while awaiting a quick look without offering free cancellation", async () => {
    const { customer, worker, job } = await fixture(), office = await person("ADMIN");
    await transitionJob(schema.db, effects, { jobId: job.id, transition: "send-to-bounty", actor: office });
    await schema.db.payment.create({ data: { jobId: job.id, kind: "QUICK_LOOK", amountCents: 3000, status: "PAID", paidAt: new Date(), idempotencyKey: randomUUID() } });
    const waiting = await schema.db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(await changeWaitingJob(schema.db, customer, job.id, revision(waiting), "cancel")).toEqual({ status: "changed" });
    expect(await changeWaitingJob(schema.db, customer, job.id, revision(waiting), "edit", input)).toEqual({ status: "saved" });
    expect(await schema.db.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ ...input, status: "QUOTE_BOUNTY", editedAt: expect.any(Date) });
    expect(await schema.db.estimate.findFirst({ where: { jobId: job.id } })).toMatchObject({ madeBeforeEdit: true });
    expect(await schema.db.notification.count({ where: { userId: worker.userId, type: "job.details_updated" } })).toBe(1);
    expect(await schema.db.auditLog.count({ where: { recordId: job.id, action: "job.cancelled" } })).toBe(0);
  });
  it("cancels for free through the machine with one history, audit and customer notification", async () => {
    const { customer, job } = await fixture();
    expect(await changeWaitingJob(schema.db, customer, job.id, revision(job), "cancel")).toEqual({ status: "cancelled" });
    expect(await schema.db.job.findUnique({ where: { id: job.id } })).toMatchObject({ status: "CANCELLED" });
    expect(await schema.db.jobStatusHistory.count({ where: { jobId: job.id, toStatus: "CANCELLED" } })).toBe(1);
    expect(await schema.db.auditLog.count({ where: { recordId: job.id, action: "job.cancelled" } })).toBe(1);
    expect(await schema.db.notification.count({ where: { userId: customer.userId, type: "job.cancelled" } })).toBe(1);
    expect(await schema.db.payment.count({ where: { jobId: job.id } })).toBe(0);
  });
  it("never uses the free-cancel dialog to request cancellation when money is already held", async () => {
    const { customer, job } = await fixture();
    await schema.db.payment.create({ data: { jobId: job.id, kind: "QUICK_LOOK", amountCents: 3000, status: "PAID", paidAt: new Date(), idempotencyKey: randomUUID() } });
    expect(await changeWaitingJob(schema.db, customer, job.id, revision(job), "cancel")).toEqual({ status: "changed" });
    expect(await schema.db.job.findUnique({ where: { id: job.id } })).toMatchObject({ status: "REVIEW", updatedAt: job.updatedAt });
    expect(await schema.db.auditLog.count({ where: { recordId: job.id } })).toBe(0);
  });
  it("allows only one of two concurrent saves with the same revision", async () => {
    const { customer, job } = await fixture();
    const results = await Promise.all([input, { ...input, title: "Different title" }].map(value => changeWaitingJob(schema.db, customer, job.id, revision(job), "edit", value)));
    expect(results.map(result => result.status).sort()).toEqual(["changed", "saved"]);
    expect(await schema.db.auditLog.count({ where: { recordId: job.id, action: "job.details_updated" } })).toBe(1);
  });
  it("rechecks a price committed while the edit waits for the job lock", async () => {
    const { customer, job } = await fixture();
    let locked!: () => void, release!: () => void;
    const acquired = new Promise<void>(resolve => { locked = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    const pricing = schema.db.$transaction(async tx => {
      await tx.job.update({ where: { id: job.id }, data: { status: "PRICED", priceCents: 10000 } });
      locked(); await gate;
    });
    await acquired;
    const editing = changeWaitingJob(schema.db, customer, job.id, revision(job), "edit", input);
    release(); await pricing;
    expect(await editing).toEqual({ status: "changed" });
    expect(await schema.db.job.findUnique({ where: { id: job.id } })).toMatchObject({ status: "PRICED", title: job.title });
    expect(await schema.db.auditLog.count({ where: { recordId: job.id, action: "job.details_updated" } })).toBe(0);
  });
  it("keeps an unpublished office draft hidden after the new free-cancel journey (#498)", async () => {
    const { customer, job } = await fixture();
    const pricing = await priceJob(schema.db, { jobId: job.id, minutes: 60, materialsCents: 0 });
    expect(pricing.ok).toBe(true);
    const draft = await schema.db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(draft.status).toBe("REVIEW"); expect(draft.priceCents).not.toBeNull();
    expect(await changeWaitingJob(schema.db, customer, job.id, revision(draft), "cancel")).toEqual({ status: "cancelled" });
    const detail = await loadCustomerJobPage(schema.db, customer, job.id);
    expect(detail.state).toBe("ready"); if (detail.state !== "ready") return;
    const listRow = await schema.db.job.findUniqueOrThrow({ where: { id: job.id }, select: JOB_LIST_SELECT });
    expect.soft(detail.job.priceCents).toBeNull();
    expect.soft(detail.job.gstCents).toBeNull();
    expect.soft(customerJobListView(customer, listRow)?.priceCents).toBeNull();
    expect(await schema.db.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: "CANCELLED", priceCents: draft.priceCents });
    expect(await schema.db.jobPricing.count({ where: { jobId: job.id } })).toBe(1);
  });
  it.each([false, true])("preserves a published price through cancellation (paid=%s)", async paid => {
    const { customer, job } = await fixture(), office = await person("ADMIN");
    await priceJob(schema.db, { jobId: job.id, minutes: 60, materialsCents: 0 });
    await transitionJob(schema.db, effects, { jobId: job.id, transition: "send-price", actor: office });
    const published = await projections(customer, job.id);
    expect(published.detail.priceCents).not.toBeNull();
    if (paid) {
      await schema.db.payment.create({ data: { jobId: job.id, kind: "JOB", amountCents: published.detail.priceCents!, status: "PAID", paidAt: new Date(), idempotencyKey: randomUUID() } });
      await transitionJob(schema.db, effects, { jobId: job.id, transition: "mark-paid", actor: { role: "SYSTEM", source: "test" } });
    }
    await transitionJob(schema.db, effects, { jobId: job.id, transition: "cancel", actor: customer, reason: paid ? "Customer requested cancellation." : undefined });
    const first = await projections(customer, job.id);
    expect(first.detail).toMatchObject({ priceCents: published.detail.priceCents, gstCents: published.detail.gstCents });
    if (paid) await transitionJob(schema.db, effects, { jobId: job.id, transition: "approve-cancel", actor: office, reason: "Approved cancellation." });
    const final = await projections(customer, job.id);
    for (const value of [final.detail, final.list]) expect(value).toMatchObject({ status: "CANCELLED", priceCents: published.detail.priceCents, gstCents: published.detail.gstCents });
  });
  it("does not treat an older published cycle as publication of a newer REVIEW draft", async () => {
    const { customer, job } = await fixture(), office = await person("ADMIN");
    await priceJob(schema.db, { jobId: job.id, minutes: 60, materialsCents: 0 });
    await transitionJob(schema.db, effects, { jobId: job.id, transition: "send-price", actor: office });
    await transitionJob(schema.db, effects, { jobId: job.id, transition: "override", actor: office, to: "REVIEW", reason: "Needs a new price." });
    await priceJob(schema.db, { jobId: job.id, minutes: 120, materialsCents: 1000 });
    const draft = await schema.db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(await changeWaitingJob(schema.db, customer, job.id, revision(draft), "cancel")).toEqual({ status: "cancelled" });
    const result = await projections(customer, job.id);
    for (const value of [result.detail, result.list]) expect(value).toMatchObject({ priceCents: null, gstCents: null });
    expect(result.row.priceCents).toBe(draft.priceCents);
  });
  it.each(["REVIEW", "QUOTE_BOUNTY"] as const)("keeps the full-job draft hidden through a paid quick-look cancellation from %s", async status => {
    const { customer, job } = await fixture(), office = await person("ADMIN");
    await priceJob(schema.db, { jobId: job.id, minutes: 60, materialsCents: 0 });
    if (status === "QUOTE_BOUNTY") await transitionJob(schema.db, effects, { jobId: job.id, transition: "send-to-bounty", actor: office });
    await schema.db.payment.create({ data: { jobId: job.id, kind: "QUICK_LOOK", amountCents: 3000, status: "PAID", paidAt: new Date(), idempotencyKey: randomUUID() } });
    await transitionJob(schema.db, effects, { jobId: job.id, transition: "cancel", actor: customer, reason: "Customer requested cancellation." });
    for (const terminal of ["CANCEL_REVIEW", "CANCELLED"] as const) {
      if (terminal === "CANCELLED") await transitionJob(schema.db, effects, { jobId: job.id, transition: "approve-cancel", actor: office, reason: "Approved cancellation." });
      const result = await projections(customer, job.id);
      for (const value of [result.detail, result.list]) expect(value).toMatchObject({ status: terminal, priceCents: null, gstCents: null });
      expect(result.row.priceCents).not.toBeNull();
    }
  });
  it("fails closed when the latest publication/cancellation history timestamps are tied", async () => {
    const { customer, job } = await fixture(), office = await person("ADMIN");
    await priceJob(schema.db, { jobId: job.id, minutes: 60, materialsCents: 0 });
    await transitionJob(schema.db, effects, { jobId: job.id, transition: "send-price", actor: office });
    await transitionJob(schema.db, effects, { jobId: job.id, transition: "cancel", actor: customer });
    const latest = await schema.db.jobStatusHistory.findFirstOrThrow({ where: { jobId: job.id }, orderBy: { createdAt: "desc" } });
    // Emulate legacy/manual histories written with transaction timestamps; the normal trigger uses clock_timestamp().
    await schema.db.jobStatusHistory.updateMany({ where: { jobId: job.id, fromStatus: { in: ["REVIEW", "PRICED"] } }, data: { createdAt: latest.createdAt } });
    const result = await projections(customer, job.id);
    expect(result.row.statusHistory[0].createdAt.getTime()).toBe(result.row.statusHistory[1].createdAt.getTime());
    for (const value of [result.detail, result.list]) expect(value).toMatchObject({ priceCents: null, gstCents: null });
    expect(result.row.priceCents).not.toBeNull();
  });
});
