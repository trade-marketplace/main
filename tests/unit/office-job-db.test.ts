// What the office can change from the job admin view (#171), against a real Postgres with the real migrations:
// every action, its audit entry with the office's note, the rules that refuse it, and the timeline it ends up on.
// Skipped without TEST_DATABASE_URL (docs/TESTING.md); CI provides one.
import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { JobStatus, Prisma, Role, Trade } from "@/generated/prisma/client";
import { getOfficeJob, type OfficeJobDatabase } from "@/server/office/job";
import { performJobAction } from "@/server/office/job-mutations";

import { testDatabaseUrl, useTestSchema } from "../support/test-db";

describe.skipIf(!testDatabaseUrl)("the job admin view's actions (database)", () => {
  const schema = useTestSchema(import.meta.filename);

  async function person(role: Role = "CUSTOMER", firstName = "Test") {
    const id = randomUUID();
    await schema.db.$executeRawUnsafe(`INSERT INTO auth.users (id) VALUES ($1::uuid)`, id);
    await schema.db.profile.create({ data: { id, email: `${id}@example.nz`, role, firstName, lastName: role } });
    return id;
  }

  /** A tradie, verified for the trade when one is given. */
  async function tradie(trade?: Trade) {
    const id = await person("TRADIE", "Aroha");
    await schema.db.workerProfile.create({ data: { userId: id } });
    if (trade) {
      await schema.db.workerTrade.create({ data: { userId: id, trade } });
      await schema.db.licence.create({
        data: { userId: id, trade, number: "EW123456", status: "VERIFIED", checkedAt: new Date(), checkedById: await person("ADMIN") },
      });
    }
    return id;
  }

  async function job(status: JobStatus, data: Partial<Prisma.JobUncheckedCreateInput> = {}) {
    const claimed = ["ASSIGNED", "SUBMITTED", "COMPLETED", "CANCEL_REVIEW"].includes(status);
    return schema.db.job.create({
      data: {
        customerId: await person(),
        category: "OTHER",
        title: "Hang a door",
        description: "Interior door, frame is fine.",
        addressLine1: "1 Example St",
        suburb: "Gladstone",
        city: "Invercargill",
        status,
        priceCents: ["REVIEW", "QUOTE_BOUNTY"].includes(status) ? null : 12_000,
        workerId: claimed ? await tradie() : null,
        ...data,
      },
    });
  }

  async function pay(jobId: string, amountCents = 12_000, kind: "JOB" | "QUICK_LOOK" = "JOB") {
    return schema.db.payment.create({
      data: { jobId, kind, amountCents, status: "PAID", paidAt: new Date(), idempotencyKey: randomUUID() },
    });
  }

  const stored = (id: string) => schema.db.job.findUniqueOrThrow({ where: { id } });
  const audits = (recordId: string) => schema.db.auditLog.findMany({ where: { recordId }, orderBy: { createdAt: "asc" } });
  const act = (officeId: string, input: Record<string, unknown>) => performJobAction(schema.db, { userId: officeId }, input);
  const read = (id: string) => getOfficeJob(schema.db as unknown as OfficeJobDatabase, id);

  describe("cancel", () => {
    it("closes a paid, claimed job, tells both people, and logs the note on the timeline", async () => {
      const office = await person("ADMIN", "Matt");
      const claimed = await job("ASSIGNED");
      await pay(claimed.id);
      const result = await act(office, { action: "cancel", jobId: claimed.id, seenStatus: "ASSIGNED", note: "Customer rang to cancel." });
      expect(result).toEqual({ ok: true });
      expect((await stored(claimed.id)).status).toBe("CANCELLED");

      const [entry] = await audits(claimed.id);
      expect(entry).toMatchObject({ action: "job.cancelled", actorId: office, actorRole: "ADMIN", reason: "Customer rang to cancel." });
      expect(entry.after).toMatchObject({ status: "CANCELLED" });
      const notified = await schema.db.notification.findMany({ where: { type: "job.cancelled" } });
      expect(notified.map((row) => row.userId).sort()).toEqual([claimed.customerId, claimed.workerId].sort());

      const view = await read(claimed.id);
      expect(view?.timeline[0]).toMatchObject({ title: "Cancelled by the office", detail: "Customer rang to cancel.", actor: "office", actorName: "Matt" });
    });

    it("refuses a job that's already closed, and a stale view, and changes nothing", async () => {
      const office = await person("ADMIN");
      const closed = await job("COMPLETED");
      expect(await act(office, { action: "cancel", jobId: closed.id, seenStatus: "COMPLETED", note: "Oops" })).toMatchObject({ ok: false, error: "not-allowed" });
      const open = await job("BOOKABLE");
      expect(await act(office, { action: "cancel", jobId: open.id, seenStatus: "PRICED", note: "Oops" })).toMatchObject({ ok: false, error: "changed" });
      expect((await stored(open.id)).status).toBe("BOOKABLE");
      expect(await audits(open.id)).toHaveLength(0);
    });

    it("refuses without a note, and for a job that doesn't exist", async () => {
      const office = await person("ADMIN");
      const open = await job("BOOKABLE");
      expect(await act(office, { action: "cancel", jobId: open.id, seenStatus: "BOOKABLE", note: " " })).toMatchObject({ ok: false, field: "note" });
      expect(await act(office, { action: "cancel", jobId: randomUUID(), seenStatus: "BOOKABLE", note: "Gone" })).toMatchObject({ ok: false, error: "not-found" });
      expect((await stored(open.id)).status).toBe("BOOKABLE");
    });
  });

  describe("reassign", () => {
    it("puts a licensed tradie on the job, keeps the status, and logs who and why", async () => {
      const office = await person("ADMIN", "Matt");
      const first = await tradie("ELECTRICAL");
      const second = await tradie("ELECTRICAL");
      const claimed = await job("ASSIGNED", { category: "ELECTRICAL", workerId: first });
      const view = await read(claimed.id);
      expect(view?.reassignOptions.map((option) => option.id)).toEqual([second]);

      const result = await act(office, { action: "reassign", jobId: claimed.id, seenStatus: "ASSIGNED", workerId: second, note: "Jack is off sick." });
      expect(result).toEqual({ ok: true });
      expect(await stored(claimed.id)).toMatchObject({ status: "ASSIGNED", workerId: second });
      const [entry] = await audits(claimed.id);
      expect(entry).toMatchObject({ action: "job.reassigned", reason: "Jack is off sick." });
      expect(entry.before).toMatchObject({ workerId: first });
      expect(entry.after).toMatchObject({ workerId: second });
      const notified = await schema.db.notification.findMany({ where: { type: "job.status_overridden" } });
      expect(notified.map((row) => row.userId).sort()).toEqual([claimed.customerId, first, second].sort());
    });

    it("uses the New Zealand licence expiry day for both candidates and reassignment", async () => {
      const now = new Date("2026-11-03T11:05:00Z");
      const office = await person("ADMIN"); const first = await tradie("ELECTRICAL"); const expired = await tradie("ELECTRICAL"); const current = await tradie("ELECTRICAL");
      await schema.db.licence.update({ where: { userId_trade: { userId: expired, trade: "ELECTRICAL" } }, data: { expiresOn: new Date("2026-11-03") } });
      await schema.db.licence.update({ where: { userId_trade: { userId: current, trade: "ELECTRICAL" } }, data: { expiresOn: new Date("2026-11-04") } });
      const claimed = await job("ASSIGNED", { category: "ELECTRICAL", workerId: first });
      const view = await getOfficeJob(schema.db as unknown as OfficeJobDatabase, claimed.id, now);
      expect(view?.reassignOptions.map(option => option.id)).not.toContain(expired);
      expect(view?.reassignOptions.map(option => option.id)).toContain(current);
      const action = (workerId: string) => performJobAction(schema.db, { userId: office }, { action: "reassign", jobId: claimed.id, seenStatus: "ASSIGNED", workerId, note: "Swap" }, now);
      expect(await action(expired)).toMatchObject({ ok: false, field: "workerId" });
      expect((await stored(claimed.id)).workerId).toBe(first);
      expect(await action(current)).toEqual({ ok: true }); expect((await stored(claimed.id)).workerId).toBe(current);
    });

    it("refuses a tradie without a verified licence, the same tradie, the customer, a non-tradie and a job with nobody on it", async () => {
      const office = await person("ADMIN");
      const first = await tradie("ELECTRICAL");
      const unlicensed = await tradie();
      const claimed = await job("ASSIGNED", { category: "ELECTRICAL", workerId: first });
      const send = (workerId: string) => act(office, { action: "reassign", jobId: claimed.id, seenStatus: "ASSIGNED", workerId, note: "Swap" });
      expect(await send(unlicensed)).toMatchObject({ ok: false, field: "workerId" });
      expect(await send(first)).toMatchObject({ ok: false, field: "workerId" });
      expect(await send(claimed.customerId)).toMatchObject({ ok: false, field: "workerId" });
      expect(await send(await person("CUSTOMER"))).toMatchObject({ ok: false, field: "workerId" });
      expect((await stored(claimed.id)).workerId).toBe(first);

      const open = await job("BOOKABLE");
      expect(await act(office, { action: "reassign", jobId: open.id, seenStatus: "BOOKABLE", workerId: first, note: "Swap" })).toMatchObject({ ok: false, error: "not-allowed" });
      expect(await audits(claimed.id)).toHaveLength(0);
    });
  });

  describe("force status", () => {
    it("moves a job to a status the normal rules wouldn't allow, takes the tradie off when it goes back, and logs it", async () => {
      const office = await person("ADMIN");
      const claimed = await job("ASSIGNED");
      const result = await act(office, { action: "status", jobId: claimed.id, seenStatus: "ASSIGNED", to: "BOOKABLE", note: "Tradie pulled out." });
      expect(result).toEqual({ ok: true });
      expect(await stored(claimed.id)).toMatchObject({ status: "BOOKABLE", workerId: null });
      expect((await audits(claimed.id))[0]).toMatchObject({ action: "job.status_overridden", reason: "Tradie pulled out." });
      const view = await read(claimed.id);
      expect(view?.timeline[0].title).toBe("Status forced to Unclaimed");
    });

    it("refuses a status the job can't be in (no price, no tradie, same status) and changes nothing", async () => {
      const office = await person("ADMIN");
      const unpriced = await job("REVIEW");
      const send = (id: string, seenStatus: JobStatus, to: JobStatus) => act(office, { action: "status", jobId: id, seenStatus, to, note: "Force" });
      expect(await send(unpriced.id, "REVIEW", "PRICED")).toMatchObject({ ok: false, field: "to" });
      expect(await send(unpriced.id, "REVIEW", "ASSIGNED")).toMatchObject({ ok: false, field: "to" });
      expect(await send(unpriced.id, "REVIEW", "REVIEW")).toMatchObject({ ok: false, field: "to" });
      expect((await stored(unpriced.id)).status).toBe("REVIEW");
      expect(await audits(unpriced.id)).toHaveLength(0);
    });
  });

  describe("edit price", () => {
    it("re-prices a job that hasn't been paid, with the job's frozen rates, and logs the note", async () => {
      const office = await person("ADMIN");
      const unpaid = await job("PRICED", { category: "ELECTRICAL" });
      const result = await act(office, { action: "price", jobId: unpaid.id, seenStatus: "PRICED", minutes: 180, materialsCents: 5_000, note: "Extra hour for access." });
      expect(result).toEqual({ ok: true });
      const after = await stored(unpaid.id);
      expect(after.priceCents).toBeGreaterThan(0);
      expect(after.priceCents).not.toBe(12_000);
      const pricing = await schema.db.jobPricing.findUniqueOrThrow({ where: { jobId: unpaid.id } });
      expect(pricing).toMatchObject({ minutes: 180, materialsCents: 5_000, note: "Extra hour for access.", pricedById: office });
      const [entry] = await audits(unpaid.id);
      expect(entry).toMatchObject({ action: "job.priced", reason: "Extra hour for access." });
      expect(entry.after).toMatchObject({ priceCents: after.priceCents });
      const view = await read(unpaid.id);
      expect(view?.pricing).toEqual({ minutes: 180, materialsCents: 5_000 });
    });

    it("refuses once the job is paid", async () => {
      const office = await person("ADMIN");
      const paid = await job("BOOKABLE", { category: "ELECTRICAL" });
      expect(await act(office, { action: "price", jobId: paid.id, seenStatus: "BOOKABLE", minutes: 60, materialsCents: 0, note: "Cheaper" })).toMatchObject({
        ok: false,
        error: "not-allowed",
      });
      expect((await stored(paid.id)).priceCents).toBe(12_000);
    });
  });

  describe("refund", () => {
    it("records a full refund against the payment, with the note on the timeline", async () => {
      const office = await person("ADMIN", "Matt");
      const paid = await job("ASSIGNED");
      const payment = await pay(paid.id);
      const result = await act(office, { action: "refund", jobId: paid.id, seenStatus: "ASSIGNED", paymentId: payment.id, mode: "full", amountCents: null, note: "Work not done." });
      expect(result).toEqual({ ok: true });
      expect(await schema.db.payment.findUniqueOrThrow({ where: { id: payment.id } })).toMatchObject({ status: "REFUNDED", refundedCents: 12_000 });
      const [entry] = await audits(payment.id);
      expect(entry).toMatchObject({ action: "payment.refunded", recordType: "payments", reason: "Work not done." });
      const view = await read(paid.id);
      expect(view?.money.refundedCents).toBe(12_000);
      expect(view?.payments).toEqual([]);
      expect(view?.timeline[0]).toMatchObject({ title: "Refunded $120.00", detail: "Work not done." });
    });

    it("records a part refund, then the rest, and never more than was paid", async () => {
      const office = await person("ADMIN");
      const paid = await job("ASSIGNED");
      const payment = await pay(paid.id);
      const refund = (mode: "full" | "partial", amountCents: number | null) =>
        act(office, { action: "refund", jobId: paid.id, seenStatus: "ASSIGNED", paymentId: payment.id, mode, amountCents, note: "Goodwill" });
      expect(await refund("partial", 5_000)).toEqual({ ok: true });
      expect(await schema.db.payment.findUniqueOrThrow({ where: { id: payment.id } })).toMatchObject({ status: "PARTIALLY_REFUNDED", refundedCents: 5_000 });
      expect((await audits(payment.id))[0].action).toBe("payment.partially_refunded");

      expect(await refund("partial", 7_001)).toMatchObject({ ok: false, field: "amount" });
      expect(await schema.db.payment.findUniqueOrThrow({ where: { id: payment.id } })).toMatchObject({ refundedCents: 5_000 });

      expect(await refund("full", null)).toEqual({ ok: true });
      expect(await schema.db.payment.findUniqueOrThrow({ where: { id: payment.id } })).toMatchObject({ status: "REFUNDED", refundedCents: 12_000 });
      expect(await refund("full", null)).toMatchObject({ ok: false, error: "not-allowed" });
      expect(await audits(payment.id)).toHaveLength(2);
    });

    it("refuses a payment that isn't paid or isn't on this job", async () => {
      const office = await person("ADMIN");
      const one = await job("ASSIGNED");
      const other = await job("ASSIGNED");
      const unpaid = await schema.db.payment.create({ data: { jobId: one.id, kind: "JOB", amountCents: 12_000, idempotencyKey: randomUUID() } });
      const elsewhere = await pay(other.id);
      const send = (paymentId: string) => act(office, { action: "refund", jobId: one.id, seenStatus: "ASSIGNED", paymentId, mode: "full", amountCents: null, note: "Refund" });
      expect(await send(unpaid.id)).toMatchObject({ ok: false, error: "not-allowed" });
      expect(await send(elsewhere.id)).toMatchObject({ ok: false, field: "paymentId" });
      expect(await schema.db.payment.findUniqueOrThrow({ where: { id: elsewhere.id } })).toMatchObject({ status: "PAID", refundedCents: 0 });
    });
  });

  describe("message both", () => {
    it("sends to the customer and the tradie in one open thread each, and reuses them", async () => {
      const office = await person("ADMIN", "Matt");
      const claimed = await job("ASSIGNED");
      expect(await act(office, { action: "message", jobId: claimed.id, body: "Kia ora both." })).toEqual({ ok: true });
      expect(await act(office, { action: "message", jobId: claimed.id, body: "Running a day late." })).toEqual({ ok: true });
      const threads = await schema.db.supportThread.findMany({ where: { jobId: claimed.id }, include: { messages: true } });
      expect(threads.map((thread) => thread.userId).sort()).toEqual([claimed.customerId, claimed.workerId].sort());
      for (const thread of threads) {
        expect(thread.messages.map((message) => [message.body, message.fromOffice, message.authorId])).toEqual([
          ["Kia ora both.", true, office],
          ["Running a day late.", true, office],
        ]);
      }
      const view = await read(claimed.id);
      expect(view?.messages.filter((message) => message.fromOffice)).toHaveLength(4);
    });

    it("sends to the customer alone when nobody has the job yet", async () => {
      const office = await person("ADMIN");
      const open = await job("BOOKABLE");
      expect(await act(office, { action: "message", jobId: open.id, body: "Hello" })).toEqual({ ok: true });
      expect(await schema.db.supportThread.count({ where: { jobId: open.id } })).toBe(1);
    });

    it("won't send an empty message", async () => {
      const office = await person("ADMIN");
      const open = await job("BOOKABLE");
      expect(await act(office, { action: "message", jobId: open.id, body: "  " })).toMatchObject({ ok: false, field: "body" });
      expect(await schema.db.supportThread.count({ where: { jobId: open.id } })).toBe(0);
    });
  });

  describe("two people at once", () => {
    it("lets one of two simultaneous cancels win and logs it once", async () => {
      const office = await person("ADMIN");
      const claimed = await job("ASSIGNED");
      const cancel = () => act(office, { action: "cancel", jobId: claimed.id, seenStatus: "ASSIGNED", note: "Cancel" });
      const results = await Promise.all([cancel(), cancel()]);
      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(results.find((result) => !result.ok)).toMatchObject({ error: "changed" });
      expect(await audits(claimed.id)).toHaveLength(1);
    });
  });

  describe("the read", () => {
    it("shows the posting, the pricing and the payment together, newest first", async () => {
      const office = await person("ADMIN", "Matt");
      const unpaid = await job("REVIEW", { category: "ELECTRICAL" });
      await act(office, { action: "price", jobId: unpaid.id, seenStatus: "REVIEW", minutes: 120, materialsCents: 0, note: "Standard." });
      const view = await read(unpaid.id);
      expect(view?.status).toBe("REVIEW");
      expect(view?.timeline.map((row) => row.title)).toEqual([expect.stringMatching(/^Priced \$/), "Posted"]);
      expect(view?.timeline[0]).toMatchObject({ actor: "office", detail: "Standard." });
      expect(await read(randomUUID())).toBeNull();
    });
  });
});
