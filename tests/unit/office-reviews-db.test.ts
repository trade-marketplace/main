import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Role } from "@/generated/prisma/client";
import { hideReview, showReview, listReviews } from "@/server/office/reviews";
import { loadService } from "@/server/services";
import { loadCustomerWorkerCard } from "@/server/jobs/customer-worker-card";
import { priceJob } from "@/server/pricing/price-job";
import { testDatabaseUrl, useTestSchema } from "../support/test-db";
describe.skipIf(!testDatabaseUrl)("office reviews transactions and public visibility", () => {
  const schema = useTestSchema(import.meta.filename);
  async function person(role: Role, firstName = "Sarah", lastName = "Taylor") { const id = randomUUID(), email = `${id}@example.test`; await schema.db.$executeRaw`INSERT INTO auth.users(id,email) VALUES(${id}::uuid,${email})`; await schema.db.profile.create({ data: { id, email, role, firstName, lastName, phone: "+64211234567" } }); return { userId: id, role }; }
  async function fixture() {
    const customer = await person("CUSTOMER"), worker = await person("TRADIE", "Jack", "Wilson"), office = await person("ADMIN", "Matt", "Larsen");
    async function reviewed(rating: number, comment: string, createdAt = new Date()) {
      const job = await schema.db.job.create({ data: { customerId: customer.userId, category: "OTHER", title: "Moderate a real review", description: "Fix a door", addressLine1: "242 Test Street", suburb: "Windsor", city: "Invercargill" } });
      await priceJob(schema.db, { jobId: job.id, minutes: 60, materialsCents: 0 });
      await schema.db.job.update({ where: { id: job.id }, data: { status: "COMPLETED", workerId: worker.userId } });
      const review = await schema.db.review.create({ data: { jobId: job.id, reviewerId: customer.userId, workerId: worker.userId, rating, tags: ["Tidy"], comment, createdAt, reportedAt: new Date(), reportedById: worker.userId, reportReason: "Please check this review." } });
      return { job, review };
    }
    const first = await reviewed(5, "The door works well. Thank you."), second = await reviewed(1, "The job needed another visit.");
    return { customer, worker, office, first, second, reviewed };
  }
  it("hiding removes the actual service testimonial and worker-card rating/count; showing restores both without changing review content", async () => {
    const f = await fixture(), id = f.first.review.id;
    const card = () => loadCustomerWorkerCard(schema.db, f.customer, f.first.job.id, async () => null);
    expect((await card())?.rating).toEqual({ average: 3, count: 2 });
    expect((await loadService("other", schema.db)).reviews.map(row => row.id)).toContain(id);
    expect(await hideReview(schema.db, f.office, id, "Includes private contact details.")).toEqual({ status: "hidden" });
    expect((await card())?.rating).toEqual({ average: 1, count: 1 });
    expect((await loadService("other", schema.db)).reviews.map(row => row.id)).not.toContain(id);
    expect(await schema.db.review.findUniqueOrThrow({ where: { id } })).toMatchObject({ rating: 5, tags: ["Tidy"], comment: f.first.review.comment, hiddenById: f.office.userId, hiddenReason: "Includes private contact details." });
    expect(await showReview(schema.db, f.office, id)).toEqual({ status: "shown" });
    expect((await card())?.rating).toEqual({ average: 3, count: 2 }); expect((await loadService("other", schema.db)).reviews.map(row => row.id)).toContain(id);
    expect(await schema.db.review.findUniqueOrThrow({ where: { id } })).toMatchObject({ hiddenAt: null, hiddenReason: null, hiddenById: null, rating: 5, tags: ["Tidy"], comment: f.first.review.comment });
    expect(await schema.db.auditLog.count({ where: { recordId: id, action: "review.hidden" } })).toBe(1); expect(await schema.db.auditLog.count({ where: { recordId: id, action: "review.shown" } })).toBe(1);
    expect(await schema.db.notification.count({ where: { userId: { in: [f.customer.userId, f.worker.userId] } } })).toBe(0);
  });
  it("requires a reason and serializes repeated hide/show without replacing the original reason or adding audits", async () => {
    const f = await fixture(), id = f.first.review.id;
    for (const reason of ["", " x ", "x".repeat(501)]) expect(await hideReview(schema.db, f.office, id, reason)).toEqual({ status: "invalid" });
    expect(await Promise.all([hideReview(schema.db, f.office, id, "Original reason"), hideReview(schema.db, f.office, id, "Another reason")])).toEqual([{ status: "hidden" }, { status: "hidden" }]);
    const hidden = await schema.db.review.findUniqueOrThrow({ where: { id } }); expect(["Original reason", "Another reason"]).toContain(hidden.hiddenReason);
    expect(await schema.db.auditLog.count({ where: { recordId: id, action: "review.hidden" } })).toBe(1);
    expect(await showReview(schema.db, f.office, id)).toEqual({ status: "shown" }); expect(await showReview(schema.db, f.office, id)).toEqual({ status: "shown" });
    expect(await schema.db.auditLog.count({ where: { recordId: id, action: "review.shown" } })).toBe(1);
  });
  it("moderates an old review without touching its expired customer edit window", async () => {
    const f = await fixture(), old = await f.reviewed(3, "An older review.", new Date(Date.now() - 10 * 86400000));
    expect(old.review.editableUntil.getTime()).toBeLessThan(Date.now());
    expect(await hideReview(schema.db, f.office, old.review.id, "A valid office reason")).toEqual({ status: "hidden" });
    expect(await showReview(schema.db, f.office, old.review.id)).toEqual({ status: "shown" });
    expect(await schema.db.review.findUniqueOrThrow({ where: { id: old.review.id } })).toMatchObject({ rating: 3, comment: "An older review.", editableUntil: old.review.editableUntil, createdAt: old.review.createdAt });
  });
  it("lists the oldest unresolved report first even when review creation order differs", async () => {
    const f = await fixture(), name = `ReportQueue${randomUUID()}`;
    await schema.db.profile.update({ where: { id: f.worker.userId }, data: { firstName: name } });
    await schema.db.review.update({ where: { id: f.first.review.id }, data: { createdAt: new Date(Date.now() - 2 * 86400000), reportedAt: new Date(Date.now() - 86400000) } });
    const reported = await listReviews(schema.db, f.office, { tab: "reported", q: name, page: 1 });
    expect(reported?.rows.map(row => row.id)).toEqual([f.first.review.id, f.second.review.id]);
    const all = await listReviews(schema.db, f.office, { tab: "all", q: name, page: 1 });
    expect(all?.rows.map(row => row.id)).toEqual([f.second.review.id, f.first.review.id]);
  });
  it("pages 25 rows at a time and clamps a page past the end", async () => {
    const f = await fixture(), name = `Paging${randomUUID()}`;
    await schema.db.profile.update({ where: { id: f.worker.userId }, data: { firstName: name } });
    for (let i = 0; i < 25; i++) await f.reviewed(4, `Paging review ${i}`);
    const first = await listReviews(schema.db, f.office, { tab: "all", q: name, page: 1 }), second = await listReviews(schema.db, f.office, { tab: "all", q: name, page: 2 });
    expect(first?.total).toBe(27); expect(first?.rows).toHaveLength(25); expect(second?.rows).toHaveLength(2);
    expect(new Set([...first!.rows, ...second!.rows].map(row => row.id)).size).toBe(27);
    expect((await listReviews(schema.db, f.office, { tab: "all", q: name, page: 999 }))?.query.page).toBe(2);
  });
  it("refuses customers, tradies, forged and revoked office roles for reads and mutations", async () => {
    const f = await fixture();
    for (const viewer of [f.customer, f.worker, { ...f.customer, role: "ADMIN" as const }]) {
      expect(await hideReview(schema.db, viewer, f.first.review.id, "A valid reason")).toEqual({ status: "forbidden" }); expect(await showReview(schema.db, viewer, f.first.review.id)).toEqual({ status: "forbidden" }); expect(await listReviews(schema.db, viewer, { tab: "all", q: "", page: 1 })).toBeNull();
    }
    await schema.db.profile.update({ where: { id: f.office.userId }, data: { role: "CUSTOMER" } }); expect(await hideReview(schema.db, f.office, f.first.review.id, "A valid reason")).toEqual({ status: "forbidden" });
  });
  it("searches people and job number, defaults to Reported, and only serializes the planned public person fields", async () => {
    const f = await fixture();
    for (const q of ["Sarah Taylor", "Jack Wilson", `TM-${f.first.job.jobNumber}`]) {
      const data = await listReviews(schema.db, f.office, { tab: "all", q, page: 1 }); expect(data?.rows.map(row => row.id)).toContain(f.first.review.id);
      expect(JSON.stringify(data)).not.toMatch(/example.test|64211234567|reviewerId|workerId/); expect(data?.rows[0].customer).toBe("Sarah T.");
    }
    expect((await listReviews(schema.db, f.office, { tab: null, q: "", page: 1 }))?.query.tab).toBe("reported");
    await hideReview(schema.db, f.office, f.first.review.id, "A valid reason");
    expect((await listReviews(schema.db, f.office, { tab: "reported", q: `TM-${f.first.job.jobNumber}`, page: 1 }))?.rows).toHaveLength(0);
    expect((await listReviews(schema.db, f.office, { tab: "hidden", q: `TM-${f.first.job.jobNumber}`, page: 1 }))?.rows).toHaveLength(1);
  });
});
