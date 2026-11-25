// The office Payments ledger (#176) against a real Postgres with the real migrations: every payment newest first,
// the filters, search by job number, name or email, the totals of the filtered list, paging, the export, and a
// refund through the job admin's own action (the one the row's Refund dialog calls) showing on the ledger.
// Fake Stripe (no network, no keys). Skipped without TEST_DATABASE_URL (docs/TESTING.md); CI provides one.
import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { PaymentKind, PaymentStatus, Role } from "@/generated/prisma/client";
import { parseOfficePaymentsQuery } from "@/lib/office-payments";
import { performJobAction } from "@/server/office/job-mutations";
import { exportOfficePayments, listOfficePayments, officePaymentsCsv } from "@/server/office/payments";

import { fakeRefunds } from "../support/fake-refunds";
import { testDatabaseUrl, useTestSchema } from "../support/test-db";

describe.skipIf(!testDatabaseUrl)("office payments ledger (database)", () => {
  const schema = useTestSchema(import.meta.filename);
  const OFFICE = { userId: randomUUID(), role: "ADMIN" as const };
  const NOW = new Date("2026-11-20T02:00:00Z");
  const list = (params: Record<string, string> = {}) => listOfficePayments(OFFICE, parseOfficePaymentsQuery(params), { db: schema.db, now: NOW });

  async function person(role: Role, firstName: string, lastName: string, email = `${randomUUID()}@example.test`, id = randomUUID()) {
    await schema.db.$executeRawUnsafe(`INSERT INTO auth.users (id) VALUES ($1::uuid)`, id);
    await schema.db.profile.create({ data: { id, email, role, firstName, lastName } });
    return id;
  }

  async function payment(customerId: string, title: string, { kind = "JOB", status = "PAID", amountCents = 10_000, refundedCents = 0, at }: { kind?: PaymentKind; status?: PaymentStatus; amountCents?: number; refundedCents?: number; at: string }) {
    const job = await schema.db.job.create({ data: { customerId, category: "OTHER", title, description: "Ledger fixture", addressLine1: "1 Fixture Street", suburb: "Windsor", city: "Invercargill", anyTime: true, status: "BOOKABLE", priceCents: amountCents } });
    const paid = ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(status);
    const intent = `pi_test_${randomUUID()}`;
    const row = await schema.db.payment.create({
      data: {
        jobId: job.id, kind, status, amountCents, refundedCents, idempotencyKey: randomUUID(), providerPaymentId: intent, createdAt: new Date(at),
        paidAt: paid ? new Date(at) : null, refundedAt: refundedCents ? new Date(at) : null,
      },
    });
    return { job, payment: row, intent };
  }

  it("lists, filters, searches, totals, pages and exports every payment; a refund through the job admin's action shows on it", async () => {
    await person("ADMIN", "Matt", "Larsen", "office@example.test", OFFICE.userId);
    const sarah = await person("CUSTOMER", "Sarah", "Thompson", "sarah.thompson@example.test");
    const tom = await person("CUSTOMER", "Tom", "Baker", "tom@builder.example.test");

    const sub = await payment(sarah, "Sub wiring", { at: "2026-11-18T01:00:00Z", amountCents: 52_000 });
    const look = await payment(sarah, "Tap washer", { at: "2026-10-10T01:00:00Z", amountCents: 3000, status: "REFUNDED", refundedCents: 3000 });
    await payment(tom, "Fence palings", { kind: "QUICK_LOOK", at: "2026-11-15T01:00:00Z", amountCents: 18_000, status: "PARTIALLY_REFUNDED", refundedCents: 5000 });
    await payment(tom, "Unpaid gutter", { at: "2026-11-19T01:00:00Z", status: "PENDING" });
    await payment(tom, "Declined card", { at: "2026-11-17T01:00:00Z", status: "FAILED" });

    // Newest first, every status; office-only fields are there for the office.
    const all = await list();
    expect(all.rows.map((row) => row.job.title)).toEqual(["Unpaid gutter", "Sub wiring", "Declined card", "Fence palings", "Tap washer"]);
    expect(all.total).toBe(5);
    expect(all.rows[1]).toMatchObject({ customer: "Sarah Thompson", email: "sarah.thompson@example.test", stripeId: sub.intent, kind: "JOB", status: "PAID", refundableCents: 52_000, job: { number: `TM-${sub.job.jobNumber}` } });
    // Totals count only the payments that took money: 52,000 + 3,000 + 18,000 paid; 8,000 back.
    expect(all.totals).toEqual({ paidCents: 73_000, refundedCents: 8000, netCents: 65_000 });

    expect((await list({ status: "refunded" })).rows.map((row) => row.job.title)).toEqual(["Tap washer"]);
    expect((await list({ kind: "QUICK_LOOK" })).rows.map((row) => row.job.title)).toEqual(["Fence palings"]);
    expect((await list({ kind: "QUICK_LOOK" })).totals).toEqual({ paidCents: 18_000, refundedCents: 5000, netCents: 13_000 });
    // October in New Zealand.
    expect((await list({ date: "last-month" })).rows.map((row) => row.job.title)).toEqual(["Tap washer"]);
    expect((await list({ date: "7d" })).rows.map((row) => row.job.title)).toEqual(["Unpaid gutter", "Sub wiring", "Declined card", "Fence palings"]);

    // Search: a job number however it's typed, a name (every word), or part of an email.
    expect((await list({ q: `TM-${look.job.jobNumber}` })).rows.map((row) => row.id)).toEqual([look.payment.id]);
    expect((await list({ q: String(sub.job.jobNumber) })).rows.map((row) => row.id)).toEqual([sub.payment.id]);
    expect((await list({ q: "sarah thompson" })).total).toBe(2);
    expect((await list({ q: "THOMPSON" })).total).toBe(2);
    expect((await list({ q: "builder.example" })).total).toBe(3);
    expect((await list({ q: "sarah baker" })).total).toBe(0);
    expect(await list({ q: "nobody-at-all" })).toEqual({ rows: [], total: 0, page: 1, totals: { paidCents: 0, refundedCents: 0, netCents: 0 } });

    // The export: the same filtered list, every page, with the office-only columns.
    const exported = await exportOfficePayments(OFFICE, parseOfficePaymentsQuery({ q: "sarah" }), { db: schema.db, now: NOW });
    expect(exported).toMatchObject({ truncated: false });
    const csv = officePaymentsCsv(exported.rows);
    expect(csv).toContain(`TM-${sub.job.jobNumber},Sub wiring,Sarah Thompson,sarah.thompson@example.test,Job,520.00,0.00,Paid,${sub.intent},${sub.payment.id}`);
    expect(csv.trim().split("\r\n")).toHaveLength(3);

    // Refund from the ledger's dialog: the job admin's own action, so the same Stripe request, audit and notification.
    const stripe = fakeRefunds();
    stripe.open(sub.intent, 52_000);
    const result = await performJobAction(
      schema.db,
      { userId: OFFICE.userId },
      { action: "refund", jobId: sub.job.id, seenStatus: "BOOKABLE", paymentId: sub.payment.id, mode: "partial", amountCents: 12_000, note: "Part not done.", requestId: randomUUID() },
      new Date(),
      null,
      stripe.api,
    );
    expect(result).toEqual({ ok: true });
    const after = (await list({ q: String(sub.job.jobNumber) })).rows[0];
    expect(after).toMatchObject({ status: "PARTIALLY_REFUNDED", refundedCents: 12_000, refundableCents: 40_000 });
    expect((await list()).totals).toEqual({ paidCents: 73_000, refundedCents: 20_000, netCents: 53_000 });
    expect((await schema.db.auditLog.findMany({ where: { recordId: sub.payment.id }, orderBy: { createdAt: "asc" } })).map((entry) => entry.action)).toEqual([
      "payment.refund_requested",
      "payment.partially_refunded",
    ]);
  });

  it("25 a page, stable newest first, and a page past the end shows the last one", async () => {
    const customer = await person("CUSTOMER", "Paging", "Person", "paging@example.test");
    const ids: string[] = [];
    for (let n = 0; n < 27; n++) ids.push((await payment(customer, `Paging ${n}`, { at: new Date(Date.UTC(2026, 8, 1 + n)).toISOString() })).payment.id);
    const first = await list({ q: "paging@example" });
    const second = await list({ q: "paging@example", page: "2" });
    expect(first).toMatchObject({ total: 27, page: 1 });
    expect(first.rows).toHaveLength(25);
    expect(second.rows.map((row) => row.id)).toEqual([ids[1], ids[0]]);
    expect(new Set([...first.rows, ...second.rows].map((row) => row.id)).size).toBe(27);
    expect(await list({ q: "paging@example", page: "40" })).toEqual(second);
  });

  it("refuses anyone but the office", async () => {
    for (const role of ["CUSTOMER", "TRADIE"] as const) {
      await expect(listOfficePayments({ userId: randomUUID(), role }, parseOfficePaymentsQuery({}), { db: schema.db })).rejects.toMatchObject({ digest: expect.stringContaining("404") });
    }
  });
});
