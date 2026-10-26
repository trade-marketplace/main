import "server-only";

import type { AuditLog, Prisma } from "@/generated/prisma/client";

import {
  AUDIT_ACTIONS,
  type AuditAction,
  type AuditReasonRequired,
  type AuditRecordTypeFor,
  auditReasonRequired,
  isAuditAction,
} from "./actions";
import { type AuditSnapshot, auditChanges } from "./snapshot";

// The audit helper (#100): every office action and every money change writes one row to `audit_log` (Schema 4,
// #92), in the same transaction as the change, so the row commits or rolls back with it.
//
//   await db.$transaction(async (tx) => {
//     const before = await tx.payment.findUniqueOrThrow({ where: { id } });
//     const after = await tx.payment.update({ where: { id }, data: { status: "REFUNDED", … } });
//     await createAudit(tx)(viewer, "payment.refunded", { type: "payments", id }, before, after, "Job cancelled");
//   });
//
// The database does the rest: the time is the insert's, the actor's role is read from their profile, and rows
// can never be changed or deleted. See docs/server/audit.md.

/** A person acting. A `Viewer` (src/server/auth/viewer.ts) is one. */
export type AuditPerson = { readonly userId: string };

/** Timers and webhooks: nobody signed in. Stored with no actor. */
export type AuditSystem = { readonly system: true };

export type AuditActor = AuditPerson | AuditSystem;

export const SYSTEM_ACTOR: AuditSystem = Object.freeze({ system: true });

/** The row an action is about. Its type is fixed by the action: "job.cancelled" is always about `jobs`. */
export type AuditRecord<A extends AuditAction = AuditAction> = {
  readonly type: AuditRecordTypeFor<A>;
  readonly id: string | number;
};

/** Actions that need a reason take it as a required string; for the rest it's optional. */
export type AuditReasonArgs<A extends AuditAction> =
  AuditReasonRequired<A> extends true ? [reason: string] : [reason?: string | null];

/**
 * Writes one audit row. `before` / `after` are the record (or the fields the caller has) before and after the
 * change: null before for a create, null after for a delete. Only the fields that changed are kept, and secrets
 * are redacted (src/server/audit/snapshot.ts). Resolves to the row written.
 */
export type AuditWriter = <A extends AuditAction>(
  actor: AuditActor,
  action: A,
  record: AuditRecord<A>,
  before: AuditSnapshot | null,
  after: AuditSnapshot | null,
  ...reason: AuditReasonArgs<A>
) => Promise<AuditLog>;

/** What the writer needs from Prisma: a transaction client (`tx`), or the client itself. */
export type AuditDb = Pick<Prisma.TransactionClient, "auditLog" | "$queryRaw" | "$executeRaw">;

/** Makes an AuditWriter for a transaction. Inject this where code builds its own transaction (e.g. #93). */
export type AuditWriterFactory = (db: AuditDb) => AuditWriter;

/** A call the catalogue doesn't allow: an unknown action, the wrong record type, no id, or a missing reason. */
export class AuditInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditInputError";
  }
}

export const createAudit: AuditWriterFactory = (db) =>
  async function audit(actor, action, record, before, after, ...rest) {
    if (!isAuditAction(action)) throw new AuditInputError(`"${String(action)}" isn't in the audit action catalogue.`);
    const recordType: string = AUDIT_ACTIONS[action].record;
    if (record.type !== recordType) {
      throw new AuditInputError(`"${action}" is about ${recordType}, not ${String(record.type)}.`);
    }
    const recordId = String(record.id).trim();
    if (!recordId) throw new AuditInputError(`"${action}" needs the record's id.`);
    const reason = (rest as [string | null | undefined])[0]?.trim() || null;
    if (!reason && auditReasonRequired(action)) throw new AuditInputError(`"${action}" needs a reason.`);

    const actorId = "system" in actor ? null : actor.userId.trim();
    if (actorId === "") throw new AuditInputError(`"${action}" needs the actor's user id, or SYSTEM_ACTOR.`);

    const changes = auditChanges(before, after);
    const write = () =>
      db.auditLog.create({
        data: {
          actorId,
          action,
          recordType,
          recordId,
          before: changes.before ?? undefined,
          after: changes.after ?? undefined,
          reason,
        },
      });

    if (actorId) return write();
    // The database fills an empty actor from `app.actor_id` (set by code acting for a person, as job status history
    // is). A system entry must stay the system's, so clear it for this insert and put it back after.
    const [setting] = await db.$queryRaw<{ actor: string | null }[]>`
      SELECT current_setting('app.actor_id', true) AS actor`;
    const named = setting?.actor;
    if (!named) return write();
    await db.$executeRaw`SELECT set_config('app.actor_id', '', true)`;
    const entry = await write();
    await db.$executeRaw`SELECT set_config('app.actor_id', ${named}, true)`;
    return entry;
  };

export { AUDIT_ACTIONS, type AuditAction, type AuditRecordType } from "./actions";
export { REDACTED, type AuditSnapshot } from "./snapshot";
