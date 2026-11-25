import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import type { Role, Trade } from "@/generated/prisma/client";
import { createAudit } from "@/server/audit/audit";
import { encryptField } from "@/server/crypto";
import { loadEarnings } from "@/server/earnings/load";
import { transitionJob, type StatusMachineDeps } from "@/server/jobs/status-machine";
import { getOfficeJob, type OfficeJobDatabase } from "@/server/office/job";
import { decideMaterials } from "@/server/office/materials";
import { CSV_BOM, exportPayroll, loadBatchCsv, loadOfficePayouts, markBatchPaid } from "@/server/office/payouts";
import { priceJob } from "@/server/pricing/price-job";

import { testDatabaseUrl, useTestSchema } from "../support/test-db";

// Materials repayment and the over-budget hold (#512), against a real migrated schema: within budget is repaid
// automatically; over budget holds the lead's payout until the office approves or changes the amount; the payroll CSV,
// the Payouts page and the tradie's Earnings agree; electrical jobs repay nothing; a crew job repays once.

const env = { FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 112).toString("base64") }; // Disposable test key, never deployed.
const NOW = new Date("2026-11-18T02:00:00.000Z"); // Wed 18 Nov, NZ; next payday Fri 20 Nov.
const REASON = "The merchant was out of the 15 mm valve, so I fitted the 20 mm kit.";

describe.skipIf(!testDatabaseUrl)("materials repayment (database)", () => {
  const schema = useTestSchema(import.meta.filename);
  const deps: StatusMachineDeps = { audit: async () => {}, notify: async () => {} };

  async function person(role: Role, firstName = "Test", lastName: string | null = "Person") {
    const id = randomUUID();
    await schema.db.$executeRawUnsafe(`INSERT INTO auth.users (id) VALUES ($1::uuid)`, id);
    await schema.db.profile.create({ data: { id, email: `${id}@example.nz`, role, firstName, lastName } });
    return id;
  }

  async function tradie(firstName = "Jack", lastName = "Wilson") {
    const userId = await person("TRADIE", firstName, lastName);
    await schema.db.payrollDetails.create({
      data: {
        userId,
        irdNumberEncrypted: encryptField("49091850", `payroll_details.ird_number:${userId}`, env),
        irdNumberLast3: "850",
        bankAccountEncrypted: encryptField("01-0902-0068389-00", `payroll_details.bank_account:${userId}`, env),
        bankAccountLast4: "8900",
        taxCode: "M",
      },
    });
    return userId;
  }

  const office = async () => ({ userId: await person("ADMIN", "Matt", "Larsen"), role: "ADMIN" as const });

  /**
   * A signed-off job whose lead reported a materials spend at finish (as #150 records it: the spend and receipt on
   * job_materials, the reason on the job.materials_reported audit entry), then signed off through the status machine,
   * which queues the payout (#164).
   */
  async function finished(workerId: string, { category = "PLUMBING" as Trade, budgetCents = 12_000, spentCents = 9_840 } = {}) {
    const customerId = await person("CUSTOMER", "Sarah", "Thompson");
    const job = await schema.db.job.create({
      data: { customerId, category, title: "Hot water valves", description: "Replace the valves.", addressLine1: "1 Example St", suburb: "Gladstone", city: "Invercargill", status: "REVIEW" },
    });
    expect(await priceJob(schema.db, { jobId: job.id, minutes: 120, materialsCents: budgetCents })).toMatchObject({ ok: true });
    await schema.db.jobMaterials.upsert({
      where: { jobId: job.id },
      create: { jobId: job.id, budgetCents, spentCents, spentAt: NOW, receiptPath: `receipts/${workerId}/${job.id}.pdf` },
      update: { budgetCents, spentCents, spentAt: NOW, receiptPath: `receipts/${workerId}/${job.id}.pdf` },
    });
    await schema.db.job.update({ where: { id: job.id }, data: { status: "SUBMITTED", workerId } });
    // This file is about materials, not photos or CoCs: relax the trade's evidence rules in this throwaway schema.
    await schema.db.tradeEvidenceRule.update({ where: { trade: category }, data: { cocRequired: false, cocFileRequired: false, minPhotos: 0, notesRequired: false } });
    await schema.db.completionEvidence.create({ data: { jobId: job.id, workerId, notes: "Done.", declaration: "The work matches the job.", declaredAt: NOW, submittedAt: NOW } });
    await createAudit(schema.db)({ userId: workerId }, "job.materials_reported", { type: "jobs", id: job.id }, null, { spentCents }, spentCents > budgetCents ? REASON : null);
    await transitionJob(schema.db, deps, { jobId: job.id, transition: "sign-off", actor: { role: "CUSTOMER", userId: customerId } });
    const payout = await schema.db.payout.findFirstOrThrow({ where: { jobId: job.id, workerId } });
    return { job: await schema.db.job.findUniqueOrThrow({ where: { id: job.id } }), payout };
  }

  const csvRow = (csv: string, payoutId: string) => csv.replace(CSV_BOM, "").trim().split("\r\n").find((line) => line.includes(payoutId));
  const officeJob = (viewer: { userId: string; role: "ADMIN" }, id: string) =>
    getOfficeJob(schema.db as unknown as OfficeJobDatabase, viewer, id, NOW, async () => "https://files.test/photo", async (path) => `https://files.test/${path}?signed`);

  beforeEach(async () => {
    // An export takes every queued payout there is: each test starts with an empty pay run.
    await schema.db.payout.deleteMany();
  });

  it("repays a spend within budget automatically: in the next export, its column and the total", async () => {
    const admin = await office();
    const jack = await tradie();
    const { payout } = await finished(jack, { budgetCents: 12_000, spentCents: 9_840 });
    const labour = payout.grossCents + payout.holidayPayCents;

    const page = await loadOfficePayouts(schema.db, admin, NOW);
    expect(page?.rows.find((row) => row.id === payout.id)).toMatchObject({ materialsCents: 9_840, totalCents: labour + 9_840, blockers: [] });
    expect(page?.materials).toEqual({ payouts: 0, jobs: [] });
    expect(page?.ready).toMatchObject({ count: 1, materialsCents: 9_840, totalCents: labour + 9_840 });

    const result = await exportPayroll(schema.db, admin, NOW);
    if (result.status !== "exported") throw new Error(`not exported: ${result.status}`);
    expect(result.batch.totalCents).toBe(labour + 9_840);
    expect(csvRow(result.csv, payout.id)).toContain(`,98.40,${((labour + 9_840) / 100).toFixed(2)},${payout.id}`);
    // The export froze the figure on its audit entry.
    const audit = await schema.db.auditLog.findFirstOrThrow({ where: { recordType: "payouts", recordId: payout.id, action: "payout.exported" } });
    expect(audit.after).toMatchObject({ materialsCents: 9_840 });
  });

  it("holds an over-budget spend: out of the export and listed as Materials to check, until the office decides", async () => {
    const admin = await office();
    const jack = await tradie();
    const other = await finished(await tradie("Aroha", "Ngata"), { spentCents: 5_000 });
    const { job, payout } = await finished(jack, { budgetCents: 12_000, spentCents: 14_650 });

    const page = await loadOfficePayouts(schema.db, admin, NOW);
    expect(page?.rows.find((row) => row.id === payout.id)).toMatchObject({ materialsCents: 0, blockers: ["materials"] });
    expect(page?.materials).toEqual({ payouts: 1, jobs: [{ jobId: job.id, jobNumber: `TM-${job.jobNumber}` }] });
    // Materials to check isn't "missing payroll details".
    expect(page?.blocked).toEqual({ tradies: 0, payouts: 0, names: [] });
    expect(page?.ready.count).toBe(1);

    const result = await exportPayroll(schema.db, admin, NOW);
    expect(result).toMatchObject({ status: "exported", heldBack: 1, materialsHeld: 1, batch: { count: 1 } });
    if (result.status !== "exported") throw new Error("not exported");
    expect(result.csv).toContain(other.payout.id);
    expect(result.csv).not.toContain(payout.id);
    expect((await schema.db.payout.findUniqueOrThrow({ where: { id: payout.id } })).status).toBe("QUEUED");
    expect(await exportPayroll(schema.db, admin, new Date(NOW.getTime() + 60_000))).toEqual({ status: "nothing", heldBack: 1, materialsHeld: 1 });

    // The job admin shows the card: budget, spend, the signed receipt, the reason, and the two decisions.
    const view = await officeJob(admin, job.id);
    expect(view?.materials).toMatchObject({
      budgetCents: 12_000, spentCents: 14_650, reason: REASON, state: "to-check", repaidCents: 0, canDecide: true, sent: false,
      receipt: { url: expect.stringContaining("?signed") },
    });
  });

  it("Approve spend: audited with the note, the tradie told, then exported with the whole spend; final once sent", async () => {
    const admin = await office();
    const jack = await tradie();
    const { job, payout } = await finished(jack, { budgetCents: 12_000, spentCents: 14_650 });

    // A note is required, and a decision for a spend that has since changed is refused.
    expect(await decideMaterials(schema.db, admin, { jobId: job.id, kind: "approve", seenSpentCents: 14_650, note: " " })).toMatchObject({ ok: false, field: "note" });
    expect(await decideMaterials(schema.db, admin, { jobId: job.id, kind: "approve", seenSpentCents: 14_000, note: "Receipt matches." })).toMatchObject({ ok: false, error: "changed" });
    // Only the office.
    expect(await decideMaterials(schema.db, { userId: jack, role: "TRADIE" }, { jobId: job.id, kind: "approve", seenSpentCents: 14_650, note: "Mine." })).toEqual({ ok: false, error: "forbidden" });
    expect(await decideMaterials(schema.db, { userId: jack, role: "ADMIN" }, { jobId: job.id, kind: "approve", seenSpentCents: 14_650, note: "Pretend." })).toEqual({ ok: false, error: "forbidden" });

    expect(await decideMaterials(schema.db, admin, { jobId: job.id, kind: "approve", seenSpentCents: 14_650, note: "Receipt matches the job." })).toEqual({ ok: true, repaidCents: 14_650 });
    const audit = await schema.db.auditLog.findMany({ where: { recordType: "job_materials", recordId: job.id, action: "materials.approved" } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorId: admin.userId, reason: "Receipt matches the job.", after: { repaidCents: 14_650, spentCents: 14_650, budgetCents: 12_000 } });
    const told = await schema.db.notification.findMany({ where: { userId: jack, type: "payout.materials_checked" } });
    expect(told).toHaveLength(1);
    expect(told[0].payload).toMatchObject({ jobId: job.id, repaidCents: 14_650 });

    const view = await officeJob(admin, job.id);
    expect(view?.materials).toMatchObject({ state: "decided", repaidCents: 14_650, decision: { kind: "approved", by: "Matt", note: "Receipt matches the job." } });
    expect(view?.timeline.some((entry) => entry.title === "Materials spend approved $146.50" && entry.detail === "Receipt matches the job.")).toBe(true);

    const result = await exportPayroll(schema.db, admin, NOW);
    if (result.status !== "exported") throw new Error("not exported");
    const labour = payout.grossCents + payout.holidayPayCents;
    expect(csvRow(result.csv, payout.id)).toContain(`,146.50,${((labour + 14_650) / 100).toFixed(2)},${payout.id}`);
    expect(result.batch.totalCents).toBe(labour + 14_650);

    // Once it has gone to payroll, the amount is final.
    expect(await decideMaterials(schema.db, admin, { jobId: job.id, kind: "change", seenSpentCents: 14_650, repaidCents: 100, note: "Too late." })).toMatchObject({ ok: false, error: "not-allowed" });
    expect((await officeJob(admin, job.id))?.materials).toMatchObject({ sent: true, canDecide: false, repaidCents: 14_650 });
  });

  it("Change amount: up to the spend, audited, tradie told, exported with that amount; the CSV and batch never change after", async () => {
    const admin = await office();
    const jack = await tradie();
    const { job, payout } = await finished(jack, { budgetCents: 12_000, spentCents: 14_650 });

    expect(await decideMaterials(schema.db, admin, { jobId: job.id, kind: "change", seenSpentCents: 14_650, repaidCents: 14_651, note: "Too much." })).toMatchObject({ ok: false, field: "amount" });
    expect(await decideMaterials(schema.db, admin, { jobId: job.id, kind: "change", seenSpentCents: 14_650, repaidCents: 13_500, note: "Extra fittings were for another job." })).toEqual({ ok: true, repaidCents: 13_500 });
    expect(await schema.db.auditLog.count({ where: { recordType: "job_materials", recordId: job.id, action: "materials.amount_changed", reason: "Extra fittings were for another job." } })).toBe(1);
    expect(await schema.db.notification.count({ where: { userId: jack, type: "payout.materials_checked" } })).toBe(1);

    const result = await exportPayroll(schema.db, admin, NOW);
    if (result.status !== "exported") throw new Error("not exported");
    expect(csvRow(result.csv, payout.id)).toContain(",135.00,");

    // Even if the spend on file changed afterwards, the sent batch keeps what was exported.
    await schema.db.jobMaterials.update({ where: { jobId: job.id }, data: { spentCents: 20_000 } });
    const again = await loadBatchCsv(schema.db, admin, result.batch.key);
    expect(again?.csv).toBe(result.csv);
    const page = await loadOfficePayouts(schema.db, admin, NOW);
    expect(page?.batches[0]).toMatchObject({ key: result.batch.key, totalCents: result.batch.totalCents });
    const paid = await markBatchPaid(schema.db, admin, result.batch.key, NOW);
    expect(paid).toMatchObject({ status: "paid", batch: { totalCents: result.batch.totalCents } });
  });

  it("repays nothing and holds nothing on an electrical job (Telfer account), even over budget", async () => {
    const admin = await office();
    const jack = await tradie();
    const { job, payout } = await finished(jack, { category: "ELECTRICAL", budgetCents: 8_500, spentCents: 9_900 });

    const page = await loadOfficePayouts(schema.db, admin, NOW);
    expect(page?.rows.find((row) => row.id === payout.id)).toMatchObject({ materialsCents: 0, blockers: [] });
    expect(page?.materials.payouts).toBe(0);
    expect(await decideMaterials(schema.db, admin, { jobId: job.id, kind: "approve", seenSpentCents: 9_900, note: "Try." })).toMatchObject({ ok: false, error: "not-allowed" });
    expect((await officeJob(admin, job.id))?.materials).toBeNull();

    const result = await exportPayroll(schema.db, admin, NOW);
    if (result.status !== "exported") throw new Error("not exported");
    expect(csvRow(result.csv, payout.id)).toContain(`,0.00,${((payout.grossCents + payout.holidayPayCents) / 100).toFixed(2)},`);
  });

  it("repays a crew job's materials once, to the lead who reported them", async () => {
    const admin = await office();
    const lead = await tradie();
    const crew = await tradie("Sam", "Patel");
    const { job, payout } = await finished(lead, { budgetCents: 12_000, spentCents: 9_840 });
    // A crew member's own payout on the same job (one per worker per job).
    const crewPayout = await schema.db.payout.create({ data: { jobId: job.id, workerId: crew, minutes: 60, rateCents: 7000, grossCents: 7000, holidayPayCents: 560 } });

    const page = await loadOfficePayouts(schema.db, admin, NOW);
    expect(page?.rows.find((row) => row.id === payout.id)?.materialsCents).toBe(9_840);
    expect(page?.rows.find((row) => row.id === crewPayout.id)?.materialsCents).toBe(0);
    expect(page?.ready.materialsCents).toBe(9_840);

    const result = await exportPayroll(schema.db, admin, NOW);
    if (result.status !== "exported") throw new Error("not exported");
    expect(csvRow(result.csv, payout.id)).toContain(",98.40,");
    expect(csvRow(result.csv, crewPayout.id)).toContain(",0.00,75.60,");
    expect(result.batch.totalCents).toBe(payout.grossCents + payout.holidayPayCents + 9_840 + 7_560);
  });

  it("the tradie's Earnings show the same materials and totals as the office: queued, held, sent and paid", async () => {
    const admin = await office();
    const jack = await tradie();
    const within = await finished(jack, { budgetCents: 12_000, spentCents: 9_840 });
    const over = await finished(jack, { budgetCents: 12_000, spentCents: 14_650 });

    const queued = await loadEarnings(schema.db, jack, NOW);
    const lines = queued.view.payrolls[0].lines;
    expect(lines.find((line) => line.id === within.payout.id)).toMatchObject({ materials: "$98.40" });
    expect(lines.find((line) => line.id === over.payout.id)).toMatchObject({ materials: "Being checked" });
    const page = await loadOfficePayouts(schema.db, admin, NOW);
    const officeTotal = page!.rows.filter((row) => [within.payout.id, over.payout.id].includes(row.id)).reduce((sum, row) => sum + row.totalCents, 0);
    expect(queued.view.next.totalCents).toBe(officeTotal);

    await decideMaterials(schema.db, admin, { jobId: over.job.id, kind: "change", seenSpentCents: 14_650, repaidCents: 13_500, note: "Part approved." });
    const result = await exportPayroll(schema.db, admin, NOW);
    if (result.status !== "exported") throw new Error("not exported");
    expect(result.batch.count).toBe(2);

    const sent = await loadEarnings(schema.db, jack, NOW);
    expect(sent.view.next.totalCents).toBe(result.batch.totalCents);
    expect(sent.view.payrolls[0].lines.find((line) => line.id === over.payout.id)).toMatchObject({ materials: "$135.00" });

    await markBatchPaid(schema.db, admin, result.batch.key, new Date("2026-11-20T01:00:00.000Z"));
    const paid = await loadEarnings(schema.db, jack, new Date("2026-11-21T01:00:00.000Z"));
    expect(paid.view.paidThisMonth.totalCents).toBe(result.batch.totalCents);
  });
});
