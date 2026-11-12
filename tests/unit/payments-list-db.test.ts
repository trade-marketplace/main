import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { listCustomerPayments } from "@/server/account/payments-list";
import { testDatabaseUrl, useTestSchema } from "../support/test-db";

describe.skipIf(!testDatabaseUrl)("customer payment list isolation and whitelist", () => {
  const schema = useTestSchema(import.meta.filename);
  async function person(role: "CUSTOMER" | "TRADIE" = "CUSTOMER") {
    const id = randomUUID(); await schema.db.$executeRaw`INSERT INTO auth.users(id) VALUES(${id}::uuid)`;
    await schema.db.profile.create({ data: { id, role, email: `${id}@example.test`, firstName: "Test" } });
    return { userId: id, role };
  }
  async function payment(customerId: string, status: "PAID" | "REFUNDED" | "PARTIALLY_REFUNDED" | "FAILED" | "PENDING" = "PAID") {
    const job = await schema.db.job.create({ data: { customerId, category: "OTHER", title: "Own paid job", description: "Local fixture", addressLine1: "1 Fixture Street", suburb: "Windsor", city: "Invercargill", anyTime: true } });
    const refund = status === "REFUNDED" || status === "PARTIALLY_REFUNDED";
    return schema.db.payment.create({ data: { jobId: job.id, kind: "QUICK_LOOK", status, amountCents: 3000, refundedCents: refund ? status === "REFUNDED" ? 3000 : 1200 : 0, paidAt: ["FAILED", "PENDING"].includes(status) ? null : new Date("2026-11-01T00:00:00Z"), refundedAt: refund ? new Date("2026-11-03T00:00:00Z") : null, idempotencyKey: randomUUID(), providerPaymentId: `pi_secret_${randomUUID()}`, providerCheckoutId: `cs_secret_${randomUUID()}`, failureReason: "Private provider canary" } });
  }
  it("lists only this customer's paid/refunded rows and explicitly strips all provider keys", async () => {
    const me = await person(), other = await person();
    const own = await payment(me.userId), refunded = await payment(me.userId, "PARTIALLY_REFUNDED");
    await payment(me.userId, "PENDING"); await payment(me.userId, "FAILED"); await payment(other.userId);
    const answer = await listCustomerPayments(schema.db, me, 1);
    expect(answer.total).toBe(3); expect(answer.rows.map(row => row.id).sort()).toEqual([`${own.id}:paid`, `${refunded.id}:paid`, `${refunded.id}:refund`].sort());
    for (const row of answer.rows) {
      expect(Object.keys(row).sort()).toEqual(["id", "kind", "amountCents", "status", "date", "job"].sort());
      expect(Object.keys(row.job).sort()).toEqual(["id", "jobNumber", "title"]);
    }
    expect(JSON.stringify(answer)).not.toMatch(/pi_secret|cs_secret|Private provider|provider|failureReason/);
    expect((await listCustomerPayments(schema.db, await person(), 1)).rows).toEqual([]);
    const tradie = await person("TRADIE"); expect((await listCustomerPayments(schema.db, tradie, 1)).rows).toEqual([]);
    expect((await listCustomerPayments(schema.db, { ...me, role: "TRADIE" }, 1)).rows).toEqual([]);
    await schema.db.profile.update({ where: { id: me.userId }, data: { role: "TRADIE" } });
    expect((await listCustomerPayments(schema.db, me, 1)).rows).toEqual([]);
  });
  it("orders and pages after expanding refunds, including out-of-range requests", async () => {
    const me = await person();
    for (let n = 0; n < 13; n++) await payment(me.userId, "REFUNDED");
    const first = await listCustomerPayments(schema.db, me, 1), last = await listCustomerPayments(schema.db, me, 2);
    expect(first).toMatchObject({ page: 1, total: 26 }); expect(first.rows).toHaveLength(25); expect(last.rows).toHaveLength(1);
    expect(first.rows.slice(0, 13).every(row => row.status === "Refunded")).toBe(true);
    expect(new Set([...first.rows, ...last.rows].map(row => row.id)).size).toBe(26);
    expect(await listCustomerPayments(schema.db, me, 200)).toEqual(last);
  });
});
