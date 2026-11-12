import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadCustomerReview, saveReview } from "@/server/jobs/customer-review";
import { testDatabaseUrl, useTestSchema } from "../support/test-db";

describe.skipIf(!testDatabaseUrl)("customer reviews after completion", () => {
  const schema = useTestSchema(import.meta.filename);
  async function person(role: "CUSTOMER" | "TRADIE" | "ADMIN" = "CUSTOMER") {
    const id = randomUUID(), email = `${id}@example.test`;
    await schema.db.$executeRaw`INSERT INTO auth.users(id,email) VALUES(${id}::uuid,${email})`;
    await schema.db.profile.create({ data: { id, email, role, firstName: role === "TRADIE" ? "Jack" : "Sarah" } });
    return { userId: id, role };
  }
  async function fixture(status: "COMPLETED" | "ASSIGNED" | "SUBMITTED" = "COMPLETED") {
    const customer = await person(), worker = await person("TRADIE");
    const job = await schema.db.job.create({ data: { customerId: customer.userId, workerId: worker.userId, category: "OTHER", title: "Move a couch", description: "Move the couch upstairs.", addressLine1: "12 Example Street", suburb: "Windsor", city: "Invercargill", status, priceCents: 10000 } });
    return { customer, worker, job };
  }
  const input = { rating: 4, tags: ["Tidy", "On time"], comment: "  Great work.  " };
  it("posts once on a completed job, returns the safe fields and writes an audit without notifications", async () => {
    const { customer, worker, job } = await fixture(), notifications = await schema.db.notification.count();
    expect(await loadCustomerReview(schema.db, customer, job.id)).toEqual({ workerFirstName: "Jack", review: null });
    const first = await saveReview(schema.db, customer, job.id, input);
    expect(first).toMatchObject({ status: "saved", data: { workerFirstName: "Jack", review: { rating: 4, tags: input.tags, comment: "Great work." } } });
    expect(await saveReview(schema.db, customer, job.id, input)).toEqual(first);
    const review = await schema.db.review.findUniqueOrThrow({ where: { jobId: job.id } });
    expect(review).toMatchObject({ reviewerId: customer.userId, workerId: worker.userId });
    expect(review.editableUntil.getTime() - review.createdAt.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
    expect(await schema.db.review.count({ where: { jobId: job.id } })).toBe(1);
    expect(await schema.db.auditLog.count({ where: { recordId: review.id, action: "review.posted" } })).toBe(1);
    expect(await schema.db.auditLog.count({ where: { recordId: review.id, action: "review.edited" } })).toBe(0);
    expect(await schema.db.notification.count()).toBe(notifications);
    const loaded = await loadCustomerReview(schema.db, customer, job.id);
    expect(Object.keys(loaded!).sort()).toEqual(["review", "workerFirstName"]);
    expect(Object.keys(loaded!.review!).sort()).toEqual(["comment", "editableUntil", "rating", "tags"]);
  });
  it("edits inside seven days with before/after audit and never creates a second row", async () => {
    const { customer, job } = await fixture();
    await saveReview(schema.db, customer, job.id, input);
    const before = await schema.db.review.findUniqueOrThrow({ where: { jobId: job.id } });
    const update = { rating: 5, tags: ["Explained well"], comment: "The repair is working well." };
    expect(await saveReview(schema.db, customer, job.id, update)).toMatchObject({ status: "saved" });
    expect(await saveReview(schema.db, customer, job.id, update)).toMatchObject({ status: "saved" });
    expect(await schema.db.review.findUniqueOrThrow({ where: { jobId: job.id } })).toMatchObject({ id: before.id, ...update, editableUntil: before.editableUntil, createdAt: before.createdAt });
    const audits = await schema.db.auditLog.findMany({ where: { recordId: before.id, action: "review.edited" } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ before: { rating: 4, tags: input.tags, comment: "Great work." }, after: update });
    expect(await schema.db.review.count({ where: { jobId: job.id } })).toBe(1);
  });
  it("refuses edits after seven days without changing review, audit or notifications", async () => {
    const { customer, worker, job } = await fixture();
    const before = await schema.db.review.create({ data: { jobId: job.id, reviewerId: customer.userId, workerId: worker.userId, rating: 4, tags: [], comment: "Original.", createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) } });
    expect(await saveReview(schema.db, customer, job.id, input)).toEqual({ status: "locked" });
    expect(await schema.db.review.findUniqueOrThrow({ where: { jobId: job.id } })).toEqual(before);
    expect(await schema.db.auditLog.count({ where: { recordId: before.id } })).toBe(0);
    expect(await schema.db.notification.count({ where: { userId: customer.userId } })).toBe(0);
  });
  it("keeps a hidden review visible to its customer and preserves all office moderation fields when edited", async () => {
    const { customer, job } = await fixture(), office = await person("ADMIN");
    await saveReview(schema.db, customer, job.id, input);
    const hidden = await schema.db.review.update({ where: { jobId: job.id }, data: { hiddenAt: new Date(), hiddenReason: "Office moderation fixture.", hiddenById: office.userId } });
    expect(await loadCustomerReview(schema.db, customer, job.id)).toMatchObject({ review: { rating: 4, comment: "Great work." } });
    expect(await saveReview(schema.db, customer, job.id, { ...input, rating: 5 })).toMatchObject({ status: "saved" });
    expect(await schema.db.review.findUniqueOrThrow({ where: { jobId: job.id } })).toMatchObject({ hiddenAt: hidden.hiddenAt, hiddenReason: hidden.hiddenReason, hiddenById: hidden.hiddenById, rating: 5 });
    expect(JSON.stringify(await loadCustomerReview(schema.db, customer, job.id))).not.toMatch(/hidden|moderation|Office/);
  });
  it("refuses foreign customers, tradies and changed roles without writing", async () => {
    const { customer, worker, job } = await fixture(), other = await person();
    for (const viewer of [worker, other]) {
      expect(await loadCustomerReview(schema.db, viewer, job.id)).toBeNull();
      expect(await saveReview(schema.db, viewer, job.id, input)).toEqual({ status: "forbidden" });
    }
    await schema.db.profile.update({ where: { id: customer.userId }, data: { role: "TRADIE" } });
    expect(await loadCustomerReview(schema.db, customer, job.id)).toBeNull();
    expect(await saveReview(schema.db, customer, job.id, input)).toEqual({ status: "forbidden" });
    expect(await schema.db.review.count({ where: { jobId: job.id } })).toBe(0);
  });
  it.each(["ASSIGNED", "SUBMITTED"] as const)("refuses a job that is %s instead of completed", async status => {
    const { customer, job } = await fixture(status);
    expect(await loadCustomerReview(schema.db, customer, job.id)).toBeNull();
    expect(await saveReview(schema.db, customer, job.id, input)).toEqual({ status: "forbidden" });
    expect(await schema.db.review.count({ where: { jobId: job.id } })).toBe(0);
  });
  it("uses the shared schema to reject invalid ratings, tags, long comments and additional fields", async () => {
    const { customer, job } = await fixture();
    for (const invalid of [{ ...input, rating: 0 }, { ...input, rating: 6 }, { ...input, tags: ["Unknown"] }, { ...input, comment: "x".repeat(1001) }, { ...input, hiddenAt: new Date().toISOString() }]) expect(await saveReview(schema.db, customer, job.id, invalid)).toEqual({ status: "invalid" });
    expect(await schema.db.review.count({ where: { jobId: job.id } })).toBe(0);
  });
  it("serializes concurrent repeated posts into one review and one audit", async () => {
    const { customer, job } = await fixture();
    const results = await Promise.all([1, 2].map(() => saveReview(schema.db, customer, job.id, input)));
    expect(results[0]).toEqual(results[1]); expect(results[0]).toMatchObject({ status: "saved" });
    const review = await schema.db.review.findUniqueOrThrow({ where: { jobId: job.id } });
    expect(await schema.db.review.count({ where: { jobId: job.id } })).toBe(1);
    expect(await schema.db.auditLog.count({ where: { recordId: review.id } })).toBe(1);
  });
});
