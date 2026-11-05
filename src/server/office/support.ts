import "server-only";
import { z } from "zod";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { OFFICE_SUPPORT_PAGE_SIZE, type OfficeSupportQuery } from "@/lib/office-support";
import { currentRole, ProblemThreadError } from "@/server/messages/service";
import { getSupportThread } from "@/server/messages/support";
import type { SupportConversation } from "@/lib/support";

type Actor = { userId: string };
type Store = Pick<PrismaClient, "profile" | "supportThread">;
const OWNER = { firstName: true, lastName: true, email: true } as const;
const META = { id: true, subject: true, jobId: true, jobParticipants: true, status: true, user: { select: OWNER },
  job: { select: { id: true, jobNumber: true, title: true } } } satisfies Prisma.SupportThreadSelect;
const selectedOwner = (person: { firstName: string; lastName: string | null; email: string }) => ({
  name: `${person.firstName}${person.lastName?.trim() ? ` ${person.lastName.trim().charAt(0)}` : ""}`, email: person.email,
});
const when = (date: Date) => new Intl.DateTimeFormat("en-NZ", { timeZone: "Pacific/Auckland", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(date);

export type OfficeSupportRow = {
  id: string; subject: string; owner: { name: string; email: string }; closed: boolean;
  kind: "job" | "support"; job: { id: string; number: string; title: string } | null;
  preview: string; unread: boolean; updatedAt: string; when: string;
};
export type OfficeSupportPage = { rows: OfficeSupportRow[]; total: number; page: number };
export type OfficeSupportDetail = { kind: "support"; viewerId: string; owner: { name: string; email: string }; job: OfficeSupportRow["job"]; conversation: SupportConversation }
  | { kind: "job"; jobId: string };

async function requireOffice(db: Pick<PrismaClient, "profile">, actor: Actor) {
  if (await currentRole(db, actor) !== "ADMIN") throw new ProblemThreadError("forbidden");
}

export function officeSupportWhere(query: OfficeSupportQuery): Prisma.SupportThreadWhereInput {
  const where: Prisma.SupportThreadWhereInput = {};
  if (query.status !== "all") where.status = query.status === "closed" ? "CLOSED" : "OPEN";
  if (query.q) {
    const text = { contains: query.q, mode: "insensitive" as const };
    const number = /^(?:TM-)?(\d{1,9})$/i.exec(query.q)?.[1];
    where.OR = [{ subject: text }, { user: { firstName: text } }, { user: { lastName: text } }, { user: { email: text } },
      ...(number ? [{ job: { jobNumber: Number(number) } }] : [])];
  }
  return where;
}

/** Office-only, bounded inbox. Notes are never used as public previews or unread messages. */
export async function listOfficeSupport(db: Store, actor: Actor, query: OfficeSupportQuery): Promise<OfficeSupportPage> {
  await requireOffice(db, actor);
  const where = officeSupportWhere(query);
  const total = await db.supportThread.count({ where });
  const page = Math.min(query.page, Math.max(1, Math.ceil(total / OFFICE_SUPPORT_PAGE_SIZE)));
  const rows = await db.supportThread.findMany({ where, orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * OFFICE_SUPPORT_PAGE_SIZE, take: OFFICE_SUPPORT_PAGE_SIZE,
    select: { ...META, lastMessageAt: true, reads: { where: { userId: actor.userId }, select: { readAt: true } },
      messages: { where: { internal: false }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: { body: true, authorId: true, createdAt: true } } },
  });
  return { total, page, rows: rows.map(row => {
    const last = row.messages[0], read = row.reads[0]?.readAt;
    return { id: row.id, subject: row.subject, owner: selectedOwner(row.user), closed: row.status === "CLOSED",
      kind: row.jobParticipants && row.job ? "job" : "support", job: row.job ? { id: row.job.id, number: `TM-${row.job.jobNumber}`, title: row.job.title } : null,
      preview: last?.body.slice(0, 240) ?? "", unread: !row.jobParticipants && !!last && last.authorId !== actor.userId && (!read || read < last.createdAt),
      updatedAt: row.lastMessageAt.toISOString(), when: when(row.lastMessageAt) };
  }) };
}

/** Shared job messages keep their established office job page; private help stays owner/office only. */
export async function getOfficeSupport(db: PrismaClient, actor: Actor, id: string, before?: string, signPhoto?: (path: string) => Promise<string>): Promise<OfficeSupportDetail | null> {
  await requireOffice(db, actor);
  if (!z.uuid().safeParse(id).success) return null;
  const thread = await db.supportThread.findUnique({ where: { id }, select: META });
  if (!thread) return null;
  if (thread.jobParticipants) return thread.jobId ? { kind: "job", jobId: thread.jobId } : null;
  const conversation = await getSupportThread(db, actor, id, signPhoto, before);
  return { kind: "support", viewerId: actor.userId, owner: selectedOwner(thread.user), job: thread.job ? { id: thread.job.id, number: `TM-${thread.job.jobNumber}`, title: thread.job.title } : null, conversation };
}
