import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import type { Role } from "@/generated/prisma/client";
import { encryptField } from "@/server/crypto";
import { loadEarnings } from "@/server/earnings/load";
import { transitionJob, type StatusMachineDeps } from "@/server/jobs/status-machine";
import { CSV_BOM, exportPayroll, loadBatchCsv, loadOfficePayouts, markBatchPaid } from "@/server/office/payouts";
import { priceJob } from "@/server/pricing/price-job";

import { testDatabaseUrl, useTestSchema } from "../support/test-db";

// Payroll export and mark paid (#166) and the Payouts page's read (#175), against a real migrated schema.

const env = { FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 166).toString("base64") }; // Disposable test key, never deployed.
const IRD = "49091850";
const BANK = "01-0902-0068389-00";
const NOW = new Date("2026-11-18T02:00:00.000Z"); // Wed 18 Nov, NZ; next payday Fri 20 Nov.

describe.skipIf(!testDatabaseUrl)("payroll export and mark paid (database)", () => {
  const schema = useTestSchema(import.meta.filename);
  const deps: StatusMachineDeps = { audit: async () => {}, notify: async () => {} };

  async function person(role: Role, firstName = "Test", lastName: string | null = "Person") {
    const id = randomUUID();
    await schema.db.$executeRawUnsafe(`INSERT INTO auth.users (id) VALUES ($1::uuid)`, id);
    await schema.db.profile.create({ data: { id, email: `${id}@example.nz`, role, firstName, lastName } });
    return id;
  }

  async function office() {
    return { userId: await person("ADMIN", "Matt", "Larsen"), role: "ADMIN" as const };
  }

  async function completeDetails(userId: string, taxCode = "M") {
    await schema.db.payrollDetails.create({
      data: {
        userId,
        irdNumberEncrypted: encryptField(IRD, `payroll_details.ird_number:${userId}`, env),
        irdNumberLast3: IRD.slice(-3),
        bankAccountEncrypted: encryptField(BANK, `payroll_details.bank_account:${userId}`, env),
        bankAccountLast4: "8900",
        taxCode,
      },
    });
  }

  /** A tradie with a signed-off job: one QUEUED payout, queued the real way (sign-off through the status machine). */
  async function signedOff(workerId: string, minutes = 120) {
    const customerId = await person("CUSTOMER");
    const job = await schema.db.job.create({
      data: { customerId, category: "OTHER", title: "Hang a door", description: "Interior door.", addressLine1: "1 Example St", suburb: "Gladstone", city: "Invercargill", status: "REVIEW" },
    });
    expect(await priceJob(schema.db, { jobId: job.id, minutes, materialsCents: 0 })).toMatchObject({ ok: true });
    await schema.db.job.update({ where: { id: job.id }, data: { status: "SUBMITTED", workerId } });
    await transitionJob(schema.db, deps, { jobId: job.id, transition: "sign-off", actor: { role: "CUSTOMER", userId: customerId } });
    return schema.db.payout.findFirstOrThrow({ where: { jobId: job.id } });
  }

  async function readyTradie(firstName = "Jack", lastName = "Wilson") {
    const id = await person("TRADIE", firstName, lastName);
    await completeDetails(id);
    return id;
  }

  const auditFor = (ids: string[], action: string) => schema.db.auditLog.findMany({ where: { recordType: "payouts", recordId: { in: ids }, action } });
  const csvLines = (csv: string) => csv.replace(CSV_BOM, "").trim().split("\r\n");

  beforeEach(async () => {
    // Every test starts with an empty pay run: an export takes every queued payout there is.
    await schema.db.notification.deleteMany({ where: { type: "payout.paid" } });
    await schema.db.payout.deleteMany();
  });

  it("exports ready payouts once: EXPORTED with one exportedAt, a CSV row each, audited, then nothing left", async () => {
    const admin = await office();
    const jack = await readyTradie();
    const aroha = await readyTradie("Aroha", "Ngata");
    const payouts = [await signedOff(jack, 120), await signedOff(jack, 90), await signedOff(aroha, 60)];

    const result = await exportPayroll(schema.db, admin, NOW);
    expect(result).toMatchObject({ status: "exported", heldBack: 0, batch: { key: NOW.toISOString(), payday: "2026-11-20", count: 3, tradies: 2, status: "EXPORTED" } });
    if (result.status !== "exported") throw new Error("not exported");
    expect(result.filename).toMatch(/^payroll-2026-11-20-\d{6}\.csv$/);
    const rows = await schema.db.payout.findMany({ where: { id: { in: payouts.map((p) => p.id) } } });
    expect(rows.map((p) => [p.status, p.exportedAt?.toISOString(), p.paidAt])).toEqual(rows.map(() => ["EXPORTED", NOW.toISOString(), null]));
    expect(result.batch.totalCents).toBe(rows.reduce((sum, p) => sum + p.grossCents + p.holidayPayCents, 0));

    const lines = csvLines(result.csv);
    expect(result.csv.startsWith(CSV_BOM)).toBe(true);
    expect(lines[0]).toBe("Tradie,Email,Job number,Hours,Rate (NZD per hour),Gross (NZD),Holiday pay (NZD),Total (NZD),Payout id");
    expect(lines).toHaveLength(4);
    const jackRow = lines.find((line) => line.includes(payouts[0].id))!;
    const job = await schema.db.job.findUniqueOrThrow({ where: { id: payouts[0].jobId } });
    expect(jackRow).toBe(`Jack Wilson,${jack}@example.nz,TM-${job.jobNumber},2,38.00,76.00,6.08,82.08,${payouts[0].id}`);
    expect(lines[1].startsWith("Aroha Ngata,")).toBe(true); // grouped by tradie
    expect(lines.find((line) => line.includes(payouts[1].id))).toContain(",1.5,38.00,57.00,4.56,61.56,");

    const audits = await auditFor(payouts.map((p) => p.id), "payout.exported");
    expect(audits).toHaveLength(3);
    expect(audits.every((entry) => entry.actorId === admin.userId && (entry.after as { status: string }).status === "EXPORTED")).toBe(true);

    expect(await exportPayroll(schema.db, admin, new Date(NOW.getTime() + 60_000))).toEqual({ status: "nothing", heldBack: 0 });
    expect(await auditFor(payouts.map((p) => p.id), "payout.exported")).toHaveLength(3);
  });

  it("holds back a tradie with missing payroll details: left QUEUED and out of the file until the details are in", async () => {
    const admin = await office();
    const ready = await signedOff(await readyTradie());
    const mereId = await person("TRADIE", "Mere", "Rāwiri");
    const held = await signedOff(mereId);
    const review = await person("TRADIE", "Sam", "Patel");
    await completeDetails(review, "UNKNOWN"); // a preserved code the office must review first
    const reviewHeld = await signedOff(review);

    const page = await loadOfficePayouts(schema.db, admin, NOW);
    expect(page?.ready).toMatchObject({ count: 1, tradies: 1 });
    expect(page?.blocked).toEqual({ tradies: 2, payouts: 2, names: ["Mere R", "Sam P"] });
    expect(page?.rows.find((row) => row.id === held.id)?.blockers).toEqual(["ird", "bank", "taxCode"]);
    expect(page?.rows.find((row) => row.id === reviewHeld.id)?.blockers).toEqual(["review"]);

    const result = await exportPayroll(schema.db, admin, NOW);
    expect(result).toMatchObject({ status: "exported", heldBack: 2, batch: { count: 1 } });
    if (result.status !== "exported") throw new Error("not exported");
    expect(result.csv).toContain(ready.id);
    expect(result.csv).not.toContain(held.id);
    expect(result.csv).not.toContain("Mere");
    expect((await schema.db.payout.findUniqueOrThrow({ where: { id: held.id } })).status).toBe("QUEUED");
    expect(await exportPayroll(schema.db, admin, NOW)).toEqual({ status: "nothing", heldBack: 2 });

    await completeDetails(mereId);
    const later = await exportPayroll(schema.db, admin, new Date(NOW.getTime() + 86_400_000));
    expect(later).toMatchObject({ status: "exported", heldBack: 1, batch: { count: 1 } });
    if (later.status === "exported") expect(later.csv).toContain("Mere Rāwiri");
  });

  it("never puts IRD numbers, bank accounts, tax codes or their ciphertext in the CSV", async () => {
    const admin = await office();
    const jack = await readyTradie();
    await signedOff(jack);
    const details = await schema.db.payrollDetails.findUniqueOrThrow({ where: { userId: jack } });
    const result = await exportPayroll(schema.db, admin, NOW);
    if (result.status !== "exported") throw new Error("not exported");
    const again = await loadBatchCsv(schema.db, admin, result.batch.key);
    for (const csv of [result.csv, again!.csv]) {
      for (const secret of [IRD, BANK, BANK.replaceAll("-", ""), details.irdNumberEncrypted!, details.bankAccountEncrypted!]) expect(csv).not.toContain(secret);
      expect(csv).not.toMatch(/IRD|bank|tax code|KiwiSaver/i);
    }
    expect(again).toEqual({ csv: result.csv, filename: result.filename });
  });

  it("two office users exporting at once never export a payout twice", async () => {
    const [first, second] = [await office(), await office()];
    const ids = [];
    for (let index = 0; index < 4; index += 1) ids.push((await signedOff(await readyTradie(`Tradie${index}`, "Test"))).id);

    const results = await Promise.all([exportPayroll(schema.db, first, NOW), exportPayroll(schema.db, second, NOW)]);
    const exported = results.filter((result) => result.status === "exported");
    expect(exported).toHaveLength(1);
    expect(results.filter((result) => result.status === "nothing")).toHaveLength(1);
    expect(exported[0]).toMatchObject({ batch: { count: 4 } });
    const audits = await auditFor(ids, "payout.exported");
    expect(audits).toHaveLength(4);
    expect(new Set(audits.map((entry) => entry.recordId)).size).toBe(4);
  });

  it("only the office can read, export, download or mark paid; the role is read from the database", async () => {
    const jack = await readyTradie();
    const payout = await signedOff(jack);
    const tradie = { userId: jack, role: "TRADIE" as const };
    const demoted = { userId: await person("CUSTOMER"), role: "ADMIN" as const }; // a stale session claiming ADMIN
    for (const viewer of [tradie, demoted]) {
      expect(await loadOfficePayouts(schema.db, viewer, NOW)).toBeNull();
      expect(await exportPayroll(schema.db, viewer, NOW)).toEqual({ status: "forbidden" });
    }
    expect((await schema.db.payout.findUniqueOrThrow({ where: { id: payout.id } })).status).toBe("QUEUED");

    const result = await exportPayroll(schema.db, await office(), NOW);
    if (result.status !== "exported") throw new Error("not exported");
    for (const viewer of [tradie, demoted]) {
      expect(await loadBatchCsv(schema.db, viewer, result.batch.key)).toBeNull();
      expect(await markBatchPaid(schema.db, viewer, result.batch.key, NOW)).toEqual({ status: "forbidden" });
    }
    expect((await schema.db.payout.findUniqueOrThrow({ where: { id: payout.id } })).status).toBe("EXPORTED");
  });

  it("marks an exported batch PAID once, tells each tradie once, and leaves queued payouts alone", async () => {
    const admin = await office();
    const jack = await readyTradie();
    const aroha = await readyTradie("Aroha", "Ngata");
    const sent = [await signedOff(jack), await signedOff(jack), await signedOff(aroha)];
    const result = await exportPayroll(schema.db, admin, NOW);
    if (result.status !== "exported") throw new Error("not exported");
    const queued = await signedOff(jack); // signed off after the export: still QUEUED, not in this batch

    const paidAt = new Date(NOW.getTime() + 2 * 86_400_000);
    const [one, two] = await Promise.all([markBatchPaid(schema.db, admin, result.batch.key, paidAt), markBatchPaid(schema.db, admin, result.batch.key, paidAt)]);
    expect([one.status, two.status].sort()).toEqual(["already-paid", "paid"]);
    const paid = one.status === "paid" ? one : two;
    expect(paid).toMatchObject({ status: "paid", notified: 2, batch: { key: result.batch.key, count: 3, tradies: 2, status: "PAID", paidAt: paidAt.toISOString() } });

    const rows = await schema.db.payout.findMany({ where: { id: { in: sent.map((p) => p.id) } } });
    expect(rows.every((p) => p.status === "PAID" && p.paidAt?.toISOString() === paidAt.toISOString())).toBe(true);
    expect((await schema.db.payout.findUniqueOrThrow({ where: { id: queued.id } })).status).toBe("QUEUED");
    expect(await auditFor(sent.map((p) => p.id), "payout.paid")).toHaveLength(3);
    expect(await auditFor([queued.id], "payout.paid")).toHaveLength(0);

    const notices = await schema.db.notification.findMany({ where: { type: "payout.paid" } });
    expect(notices.map((n) => n.userId).sort()).toEqual([jack, aroha].sort());
    expect(notices.find((n) => n.userId === jack)?.payload).toMatchObject({ batch: result.batch.key, payouts: 2 });

    expect(await markBatchPaid(schema.db, admin, result.batch.key, paidAt)).toMatchObject({ status: "already-paid" });
    expect(await schema.db.notification.count({ where: { type: "payout.paid" } })).toBe(2);
    expect(await auditFor(sent.map((p) => p.id), "payout.paid")).toHaveLength(3);
  });

  it("marks only EXPORTED payouts: unknown or malformed batches are refused", async () => {
    const admin = await office();
    await signedOff(await readyTradie());
    expect(await markBatchPaid(schema.db, admin, NOW.toISOString(), NOW)).toEqual({ status: "not-found" });
    expect(await markBatchPaid(schema.db, admin, "not-a-date", NOW)).toEqual({ status: "not-found" });
    expect(await markBatchPaid(schema.db, admin, "2026-11-18T02:00:00Z", NOW)).toEqual({ status: "not-found" });
    expect(await schema.db.payout.count({ where: { status: { not: "QUEUED" } } })).toBe(0);
    expect(await schema.db.notification.count({ where: { type: "payout.paid" } })).toBe(0);
  });

  it("lists batches newest first with their status, and the next export never shares an earlier batch's time", async () => {
    const admin = await office();
    const jack = await readyTradie();
    await signedOff(jack);
    const first = await exportPayroll(schema.db, admin, NOW);
    await signedOff(jack);
    const second = await exportPayroll(schema.db, admin, NOW); // same clock: nudged 1 ms on
    if (first.status !== "exported" || second.status !== "exported") throw new Error("not exported");
    expect(new Date(second.batch.key).getTime()).toBe(NOW.getTime() + 1);
    await markBatchPaid(schema.db, admin, first.batch.key, NOW);

    const page = await loadOfficePayouts(schema.db, admin, NOW);
    expect(page?.payday).toBe("2026-11-20");
    expect(page?.rows).toEqual([]);
    expect(page?.batches.map((batch) => [batch.key, batch.status, batch.count])).toEqual([
      [second.batch.key, "EXPORTED", 1],
      [first.batch.key, "PAID", 1],
    ]);
  });

  it("the tradie's Earnings still say Queued after the export and Paid once the batch is marked paid", async () => {
    const admin = await office();
    const jack = await readyTradie();
    const payout = await signedOff(jack);
    const total = payout.grossCents + payout.holidayPayCents;

    const before = await loadEarnings(schema.db, jack, NOW);
    expect(before.view.payrolls[0]).toMatchObject({ status: "Queued", label: "Fri 20 Nov", totalCents: total });

    const result = await exportPayroll(schema.db, admin, NOW);
    if (result.status !== "exported") throw new Error("not exported");
    const exported = await loadEarnings(schema.db, jack, NOW);
    expect(exported.view.payrolls[0]).toMatchObject({ status: "Queued", label: "Fri 20 Nov", totalCents: total });
    expect(exported.view.next).toMatchObject({ totalCents: total, jobs: 1 });

    const paidAt = new Date("2026-11-20T01:00:00.000Z");
    await markBatchPaid(schema.db, admin, result.batch.key, paidAt);
    const paid = await loadEarnings(schema.db, jack, new Date("2026-11-21T01:00:00.000Z"));
    expect(paid.view.payrolls[0]).toMatchObject({ status: "Paid", totalCents: total });
    expect(paid.view.paidThisMonth).toEqual({ totalCents: total, jobs: 1 });
    expect(paid.view.next).toMatchObject({ totalCents: 0, jobs: 0 });
  });
});
