import { randomBytes, randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { Role } from "@/generated/prisma/client";
import { AUDIT_ACTIONS, AUDIT_RECORD_TYPES, auditReasonRequired, isAuditAction } from "@/server/audit/actions";
import {
  AuditInputError,
  type AuditDb,
  type AuditWriter,
  type AuditWriterFactory,
  REDACTED,
  SYSTEM_ACTOR,
  createAudit,
} from "@/server/audit/audit";
import { encryptField } from "@/server/crypto";

import { testDatabaseUrl, useTestSchema } from "../support/test-db";

// The audit helper (#100): one row per office action or money change, written in the caller's transaction.

/** A stand-in Prisma client that remembers what would be written. */
function fakeDb(actorSetting: string | null = null) {
  const writes: Record<string, unknown>[] = [];
  const raw: string[] = [];
  const db = {
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        writes.push(data);
        return { id: randomUUID(), createdAt: new Date(), actorRole: null, ...data };
      },
    },
    $queryRaw: async () => [{ actor: actorSetting }],
    $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      raw.push(strings.join("?") + JSON.stringify(values));
      return 1;
    },
  } as unknown as AuditDb;
  return { db, writes, raw };
}

const office = { userId: randomUUID(), role: "ADMIN" as Role, email: "office@example.nz" };

describe("the action catalogue", () => {
  it("only has actions the database accepts, each about a known table", () => {
    for (const [action, rule] of Object.entries(AUDIT_ACTIONS)) {
      expect(action).toMatch(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/);
      expect(AUDIT_RECORD_TYPES).toContain(rule.record);
    }
  });

  it("needs a reason for overrides and refusals", () => {
    expect(auditReasonRequired("job.status_overridden")).toBe(true);
    expect(auditReasonRequired("payment.refunded")).toBe(true);
    expect(auditReasonRequired("licence.rejected")).toBe(true);
    expect(auditReasonRequired("licence.verified")).toBe(false);
    expect(isAuditAction("job.cancelled")).toBe(true);
    expect(isAuditAction("toString")).toBe(false);
  });

  it("is enforced by the types: no free text, no wrong table, no missing reason", () => {
    // Never run: these lines only have to (not) compile.
    const typed = (audit: AuditWriter) => {
      void audit(office, "licence.verified", { type: "licences", id: "l" }, { status: "PENDING" }, { status: "VERIFIED" });
      void audit(office, "payment.refunded", { type: "payments", id: "p" }, null, null, "Cancelled before work");
      void audit(SYSTEM_ACTOR, "job.auto_completed", { type: "jobs", id: "j" }, null, null);
      // @ts-expect-error free-text action
      void audit(office, "job was cancelled", { type: "jobs", id: "j" }, null, null, "why");
      // @ts-expect-error a job action about a payment
      void audit(office, "job.claimed", { type: "payments", id: "p" }, null, null);
      // @ts-expect-error a refund needs a reason
      void audit(office, "payment.refunded", { type: "payments", id: "p" }, null, null);
    };
    const factory: AuditWriterFactory = createAudit;
    expect(typeof typed).toBe("function");
    expect(typeof factory).toBe("function");
  });
});

describe("createAudit (no database)", () => {
  it("writes the person, the action, the record and only what changed", async () => {
    const { db, writes } = fakeDb();
    const audit = createAudit(db);
    await audit(office, "licence.rejected", { type: "licences", id: "l1" }, { id: "l1", status: "PENDING" }, {
      id: "l1",
      status: "REJECTED",
    }, "  Licence number not on the register ");
    expect(writes).toEqual([
      {
        actorId: office.userId,
        action: "licence.rejected",
        recordType: "licences",
        recordId: "l1",
        before: { status: "PENDING" },
        after: { status: "REJECTED" },
        reason: "Licence number not on the register",
      },
    ]);
  });

  it("takes a numeric id (settings is id 1) and treats an empty reason as none", async () => {
    const { db, writes } = fakeDb();
    await createAudit(db)(office, "settings.updated", { type: "settings", id: 1 }, { marginBps: 2000 }, { marginBps: 2200 }, " ");
    expect(writes[0]).toMatchObject({ recordId: "1", reason: null });
  });

  it("refuses an action that isn't in the catalogue, even when the types were cast away", async () => {
    const { db, writes } = fakeDb();
    const audit = createAudit(db) as unknown as (...args: unknown[]) => Promise<unknown>;
    await expect(audit(office, "job.deleted_forever", { type: "jobs", id: "j" }, null, null)).rejects.toThrow(AuditInputError);
    await expect(audit(office, "hasOwnProperty", { type: "jobs", id: "j" }, null, null)).rejects.toThrow(AuditInputError);
    await expect(audit(office, "job.claimed", { type: "payments", id: "j" }, null, null)).rejects.toThrow(/about jobs/);
    await expect(audit(office, "job.claimed", { type: "jobs", id: " " }, null, null)).rejects.toThrow(/id/);
    await expect(audit(office, "payment.refunded", { type: "payments", id: "p" }, null, null)).rejects.toThrow(/reason/);
    await expect(audit({ userId: "" }, "job.claimed", { type: "jobs", id: "j" }, null, null)).rejects.toThrow(/actor/);
    expect(writes).toEqual([]);
  });

  it("writes the system with no actor", async () => {
    const { db, writes, raw } = fakeDb();
    await createAudit(db)(SYSTEM_ACTOR, "job.auto_completed", { type: "jobs", id: "j" }, { status: "SUBMITTED" }, {
      status: "COMPLETED",
    });
    expect(writes[0]).toMatchObject({ actorId: null, action: "job.auto_completed" });
    expect(raw).toEqual([]);
  });

  it("clears a person named for the transaction while it writes the system's row, then puts them back", async () => {
    const someone = randomUUID();
    const { db, writes, raw } = fakeDb(someone);
    await createAudit(db)(SYSTEM_ACTOR, "payment.paid", { type: "payments", id: "p" }, null, null);
    expect(writes).toHaveLength(1);
    expect(raw).toEqual([
      `SELECT set_config('app.actor_id', '', true)[]`,
      `SELECT set_config('app.actor_id', ?, true)${JSON.stringify([someone])}`,
    ]);
  });
});

describe.skipIf(!testDatabaseUrl)("createAudit (database)", () => {
  const schema = useTestSchema(import.meta.filename);

  async function createPerson(role: Role = "CUSTOMER") {
    const id = randomUUID();
    await schema.db.$executeRawUnsafe(`INSERT INTO auth.users (id) VALUES ($1::uuid)`, id);
    return schema.db.profile.create({ data: { id, email: `${id}@example.nz`, role, firstName: "Test" } });
  }

  const entriesFor = (recordType: string, recordId: string) =>
    schema.db.auditLog.findMany({ where: { recordType, recordId }, orderBy: { createdAt: "asc" } });

  it("commits with the caller's change, and the database adds the role and the time", async () => {
    const person = await createPerson("ADMIN");
    const viewer = { userId: person.id, role: person.role, email: person.email, firstName: "Test", emailVerified: true };
    await schema.db.$transaction(async (tx) => {
      const before = await tx.settings.findUniqueOrThrow({ where: { id: 1 } });
      const after = await tx.settings.update({ where: { id: 1 }, data: { otherRateCents: before.otherRateCents + 100 } });
      await createAudit(tx)(viewer, "settings.updated", { type: "settings", id: 1 }, before, after, "Rate review");
    });
    const [entry] = await entriesFor("settings", "1");
    const settings = await schema.db.settings.findUniqueOrThrow({ where: { id: 1 } });
    expect(entry).toMatchObject({
      actorId: person.id,
      actorRole: "ADMIN",
      action: "settings.updated",
      before: { otherRateCents: settings.otherRateCents - 100 },
      after: { otherRateCents: settings.otherRateCents },
      reason: "Rate review",
    });
    // Only the rate and the update time changed.
    expect(Object.keys(entry.after as object).sort()).toEqual(["otherRateCents", "updatedAt"]);
    expect(Math.abs(entry.createdAt.getTime() - Date.now())).toBeLessThan(60_000);
  });

  it("rolls back with the caller: no change, no audit row", async () => {
    const person = await createPerson("ADMIN");
    const before = await schema.db.settings.findUniqueOrThrow({ where: { id: 1 } });
    const written = (await entriesFor("settings", "1")).length;
    await expect(
      schema.db.$transaction(async (tx) => {
        const after = await tx.settings.update({ where: { id: 1 }, data: { marginBps: before.marginBps + 1 } });
        await createAudit(tx)({ userId: person.id }, "settings.updated", { type: "settings", id: 1 }, before, after);
        throw new Error("the rest of the action failed");
      }),
    ).rejects.toThrow("the rest of the action failed");
    expect(await entriesFor("settings", "1")).toHaveLength(written);
    expect((await schema.db.settings.findUniqueOrThrow({ where: { id: 1 } })).marginBps).toBe(before.marginBps);
  });

  it("rolls the change back when the audit row can't be written", async () => {
    const before = await schema.db.settings.findUniqueOrThrow({ where: { id: 1 } });
    await expect(
      schema.db.$transaction(async (tx) => {
        await tx.settings.update({ where: { id: 1 }, data: { marginBps: before.marginBps + 1 } });
        // Not a uuid: the insert fails, so the whole action does.
        await createAudit(tx)({ userId: "not-a-uuid" }, "settings.updated", { type: "settings", id: 1 }, null, null);
      }),
    ).rejects.toThrow();
    expect((await schema.db.settings.findUniqueOrThrow({ where: { id: 1 } })).marginBps).toBe(before.marginBps);
  });

  it("can't be changed or deleted once written", async () => {
    const person = await createPerson("ADMIN");
    const entry = await createAudit(schema.db)({ userId: person.id }, "review.hidden", { type: "reviews", id: "r1" }, null, null, "Abusive");
    await expect(schema.db.auditLog.update({ where: { id: entry.id }, data: { reason: "Nicer reason" } })).rejects.toThrow(/append-only/);
    await expect(schema.db.auditLog.delete({ where: { id: entry.id } })).rejects.toThrow(/append-only/);
    expect(await schema.db.auditLog.findUniqueOrThrow({ where: { id: entry.id } })).toMatchObject({ reason: "Abusive" });
  });

  it("never stores an IRD number or bank account, plain or encrypted", async () => {
    const worker = await createPerson("TRADIE");
    const env = { FIELD_ENCRYPTION_KEY: randomBytes(32).toString("base64") };
    const context = `payroll_details:${worker.id}`;
    const entry = await schema.db.$transaction(async (tx) => {
      const after = await tx.payrollDetails.create({
        data: {
          userId: worker.id,
          irdNumberEncrypted: encryptField("123456789", context, env),
          irdNumberLast3: "789",
          bankAccountEncrypted: encryptField("12-3456-7890123-00", context, env),
          bankAccountLast4: "2300",
          taxCode: "M",
        },
      });
      return createAudit(tx)({ userId: worker.id }, "payroll_details.updated", { type: "payroll_details", id: worker.id }, null, {
        ...after,
        irdNumber: "123456789",
      });
    });
    const stored = JSON.stringify(await schema.db.auditLog.findUniqueOrThrow({ where: { id: entry.id } }));
    expect(stored).not.toMatch(/123456789|7890123/);
    expect(stored).not.toMatch(/v1\.[A-Za-z0-9_-]{16}\./);
    expect(entry.after).toMatchObject({
      irdNumberEncrypted: REDACTED,
      bankAccountEncrypted: REDACTED,
      irdNumber: REDACTED,
      irdNumberLast3: "789",
      bankAccountLast4: "2300",
    });
  });

  it("writes the system with no actor, even inside a transaction acting for a person", async () => {
    const person = await createPerson("ADMIN");
    const jobId = randomUUID();
    const [system, theirs, setting] = await schema.db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.actor_id', $1, true)`, person.id);
      const audit = createAudit(tx);
      const system = await audit(SYSTEM_ACTOR, "job.auto_completed", { type: "jobs", id: jobId }, { status: "SUBMITTED" }, {
        status: "COMPLETED",
      });
      // A row written straight after still goes to the person the transaction names.
      const theirs = await tx.auditLog.create({ data: { action: "job.status_changed", recordType: "jobs", recordId: jobId } });
      const [{ actor }] = await tx.$queryRaw<{ actor: string }[]>`SELECT current_setting('app.actor_id', true) AS actor`;
      return [system, theirs, actor];
    });
    expect(system).toMatchObject({ actorId: null, actorRole: null, after: { status: "COMPLETED" } });
    expect(theirs).toMatchObject({ actorId: person.id, actorRole: "ADMIN" });
    expect(setting).toBe(person.id);
  });

  it("writes the system with no actor outside a transaction", async () => {
    const entry = await createAudit(schema.db)(SYSTEM_ACTOR, "payment.paid", { type: "payments", id: randomUUID() }, { status: "PENDING" }, {
      status: "PAID",
    });
    expect(entry).toMatchObject({ actorId: null, actorRole: null });
  });
});
