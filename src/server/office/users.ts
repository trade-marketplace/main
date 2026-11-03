import "server-only";

import { z } from "zod";

import type { Prisma, PrismaClient, Role } from "@/generated/prisma/client";
import { createAudit, SYSTEM_ACTOR, type AuditActor } from "@/server/audit/audit";
import { getDb } from "@/server/db";

const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());
const select = { id: true, email: true, role: true } as const;

export class OfficeUserError extends Error {
  constructor(readonly code: "invalid-email" | "unknown-account" | "last-admin" | "forbidden") {
    super({
      "invalid-email": "Enter a valid email address.",
      "unknown-account": "No account has that email. They must sign up first.",
      "last-admin": "Cannot remove the last office user. Add another office user first.",
      "forbidden": "Office access is required.",
    }[code]);
    this.name = "OfficeUserError";
  }
}

export function officeUserEmail(input: string): string {
  const email = emailSchema.safeParse(input);
  if (!email.success) throw new OfficeUserError("invalid-email");
  return email.data;
}

export type OfficeUser = { id: string; email: string; role: Role };
export type OfficeUserChange = OfficeUser & { changed: boolean };
export type OfficeUserListing = { email: string; since: Date | null };
export type SessionRevoker = (tx: Prisma.TransactionClient, userId: string) => Promise<void>;

/**
 * The database equivalent of Auth's global sign-out (#107): remove refresh tokens and sessions, never JWTs
 * or passwords. Auth's existing access tokens can live until expiry; the freshly read profile role denies
 * office access immediately. Using the privileged database connection avoids needing the user's JWT or an
 * Auth secret. Failure rolls back the role change, too. See Supabase's Auth sessions guide.
 */
export const revokeOfficeSessions: SessionRevoker = async (tx, userId) => {
  await tx.$executeRaw`DELETE FROM auth.refresh_tokens WHERE user_id::text = ${userId}`;
  await tx.$executeRaw`DELETE FROM auth.sessions WHERE user_id = ${userId}::uuid`;
};

/** Server-only capability. Callers in a future Settings action must first authorize ADMIN with withRole(). */
export function officeUsers(db: PrismaClient = getDb(), revokeSessions: SessionRevoker = revokeOfficeSessions, actor: AuditActor = SYSTEM_ACTOR) {
  async function find(email: string): Promise<OfficeUser> {
    const profile = await db.profile.findUnique({ where: { email: officeUserEmail(email) }, select });
    if (!profile) throw new OfficeUserError("unknown-account");
    return profile;
  }

  async function change(input: string, role: "ADMIN" | "CUSTOMER"): Promise<OfficeUserChange> {
    const email = officeUserEmail(input);
    return db.$transaction(async (tx) => {
      // Serialize all add/remove calls, including competing removals of the final two admins. READ COMMITTED
      // means the count below sees the previous holder's commit after this lock becomes available.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(178, 1)`;
      if (!("system" in actor)) {
        const currentActor = await tx.profile.findUnique({ where: { id: actor.userId }, select: { role: true } });
        if (currentActor?.role !== "ADMIN") throw new OfficeUserError("forbidden");
      }
      const before = await tx.profile.findUnique({ where: { email }, select });
      if (!before) throw new OfficeUserError("unknown-account");
      if (before.role === role || (role === "CUSTOMER" && before.role !== "ADMIN")) {
        return { ...before, changed: false };
      }
      if (role === "CUSTOMER" && await tx.profile.count({ where: { role: "ADMIN" } }) <= 1) {
        throw new OfficeUserError("last-admin");
      }
      const after = await tx.profile.update({ where: { id: before.id }, data: { role }, select });
      if (role === "CUSTOMER") await revokeSessions(tx, before.id);
      // Audit actor ids are UUIDs. A script is the system actor, explicitly identified by reason="script".
      await createAudit(tx)(actor, role === "ADMIN" ? "office_user.added" : "office_user.removed",
        { type: "profiles", id: before.id }, { role: before.role }, { role }, "system" in actor ? "script" : null);
      return { ...after, changed: true };
    });
  }

  return {
    find,
    add: (email: string) => change(email, "ADMIN"),
    remove: (email: string) => change(email, "CUSTOMER"),
    async list(): Promise<OfficeUserListing[]> {
      const profiles = await db.profile.findMany({ where: { role: "ADMIN" }, select, orderBy: { email: "asc" } });
      const entries = await db.auditLog.findMany({
        where: { action: "office_user.added", recordType: "profiles", recordId: { in: profiles.map(({ id }) => id) } },
        orderBy: { createdAt: "desc" }, select: { recordId: true, createdAt: true },
      });
      return profiles.map(({ id, email }) => ({ email, since: entries.find((entry) => entry.recordId === id)?.createdAt ?? null }));
    },
  };
}
