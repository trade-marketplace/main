# Audit log helper

Every office action and every money change writes one row to `audit_log` (Schema 4, #92) through one helper (#100).
The office reads these rows as a record's timeline: the job admin view (F05), licence decisions (F08), settings
changes (F14).

Code: `src/server/audit/` (server-only).

| File | What it holds |
|---|---|
| `audit.ts` | `createAudit(db)` → the writer; the `AuditWriter`, `AuditWriterFactory`, `AuditActor` types; `SYSTEM_ACTOR` |
| `actions.ts` | The action catalogue `AUDIT_ACTIONS`: every allowed action, its table, whether it needs a reason |
| `snapshot.ts` | `auditChanges(before, after)`: keeps only the changed fields, as JSON, with secrets redacted |

Tests: `tests/unit/audit.test.ts` (catalogue, writer, and against a real Postgres) and
`tests/unit/audit-snapshot.test.ts` (diffs and redaction).

## Using it

Write the audit row **in the same transaction** as the change, so both commit or neither does:

```ts
import { createAudit } from "@/server/audit/audit";

await db.$transaction(async (tx) => {
  const before = await tx.payment.findUniqueOrThrow({ where: { id } });
  const after = await tx.payment.update({ where: { id }, data: { status: "REFUNDED", refundedCents, refundedAt } });
  await createAudit(tx)(viewer, "payment.refunded", { type: "payments", id }, before, after, "Cancelled before work");
});
```

`audit(actor, action, record, before, after, reason?)`:

- **actor**: who did it. A `Viewer` from `getViewer()` / `withRole()` (#101) works as is: only `userId` is read.
  Use `SYSTEM_ACTOR` for timers and webhooks (the sign-off timer, Stripe). The database fills in the person's role
  from `profiles` as it is at that moment, so the row keeps the role they had.
- **action**: one of `AUDIT_ACTIONS` (see below). Anything else doesn't compile, and throws `AuditInputError` if the
  types were cast away.
- **record**: `{ type, id }`. The type is the Postgres table name and is fixed by the action (`"job.cancelled"` is
  always `{ type: "jobs", … }`). The id can be a number (`settings` is id 1).
- **before / after**: the row before and after, as Prisma returns it (or just the fields you have). `null` before
  for a create, `null` after for a delete. Only changed fields are stored (see below).
- **reason**: why. Required by the types for actions marked `reason: "required"`; blank counts as none.

It resolves to the row written (`AuditLog`). It throws `AuditInputError` before writing anything if the call breaks
the catalogue; any database error (e.g. an actor id that isn't a uuid) throws too and rolls the transaction back.

Calling `createAudit(getDb())` outside a transaction works (the row is written on its own) but only use that when
nothing else changes, because a failure after it can't take the row back.

### For code that runs its own transaction (e.g. the job status machine, #93)

Take the factory as a dependency and build the writer from your `tx`:

```ts
import type { AuditWriterFactory } from "@/server/audit/audit";

type Deps = { audit: AuditWriterFactory }; // the app passes createAudit; tests pass a fake

await db.$transaction(async (tx) => {
  // …change the job…
  await deps.audit(tx)(actor, "job.claimed", { type: "jobs", id: job.id }, before, after);
});
```

If you only ever get a ready writer for one transaction, take an `AuditWriter` instead. A fake for tests:

```ts
const calls: unknown[][] = [];
const audit: AuditWriterFactory = () => (async (...args: unknown[]) => { calls.push(args); return {} as AuditLog; }) as unknown as AuditWriter;
```

## The action catalogue

`AUDIT_ACTIONS` in `src/server/audit/actions.ts`. Names are dotted lower case, past tense (`licence.verified`,
`payment.refunded`), which the database also checks. Each says which table it's about and whether it needs a reason.
A reason is required where the office overrides something or says no (cancel, reassign, force a status, refund,
reject a licence, pause a worker, flag evidence, hide a review, change a role), since it's shown on the timeline and,
for rejections, to the person affected.

**Adding an action:** add one line to `AUDIT_ACTIONS` (and its table to `AUDIT_RECORD_TYPES` if it's new). Never
rename or remove one that may have been written: old rows keep the old name, so a rename splits the timeline.

Jobs have a named action per transition where there is one (`job.claimed`, `job.auto_completed`…);
`job.status_changed` is for a transition without one, and `job.status_overridden` (reason required) is the office
forcing a status.

## What's stored

- **Only what changed.** For an update, a field is stored (old value in `before`, new in `after`) only if it
  changed; unchanged fields are left out of both. A field only one side has counts as changed, with null on the other.
  If nothing changed, both are `{}`: the action still happened. A create stores every field of `after`, a delete
  every field of `before`. Fields are compared as whole columns, so a JSON column that changed is stored whole.
- **Plain JSON.** Dates become ISO strings, bigints and decimals strings, binary `"[binary]"`. `undefined` fields
  are left out.
- **The rest comes from the database** (Schema 4 migration): `created_at` is always the insert's time; the actor's
  role is read from `profiles`; rows can never be updated, deleted or truncated (`audit_log_is_append_only`).

## Never logged: secrets

Before anything is written, these values become `"[redacted]"` (the field still shows as changed, so the timeline
can say "bank account changed" without the number):

- Encrypted columns: `irdNumberEncrypted`, `bankAccountEncrypted` (`src/server/crypto.ts`), and any field whose name
  says encrypted, password, secret, token, API / private / signing key.
- `irdNumber` and `bankAccount` themselves, in case a caller passes the plain value.
- Any string shaped like an encrypted field (`v1.<iv>.<tag>.<ciphertext>`), whatever the field is called.

This applies at any depth inside JSON fields. The masked digits (`irdNumberLast3`, `bankAccountLast4`) are kept.
Still, don't pass secrets in: pick the fields you need when a row might carry something sensitive that isn't
named like one.

## The system actor

`SYSTEM_ACTOR` writes a row with no actor (`actor_id` and `actor_role` empty), which the timeline shows as the
system. The database fills an empty actor from `app.actor_id` (the person code acting for someone names with
`SET LOCAL`, as job status history does), so for a system row the helper clears that setting for the insert and
puts it back straight after. A person's row always names them explicitly.
