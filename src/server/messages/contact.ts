import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Viewer } from "@/server/auth/viewer";
import { currentRole } from "./service";

/** Contact keeps a job's context when supplied; it never chooses or exposes somebody else's thread. */
export async function problemContactHref(db: PrismaClient, viewer: Pick<Viewer, "userId">, jobId?: string) {
  const role = await currentRole(db, viewer);
  if (role === "ADMIN") return "/admin";
  if (jobId && !/^[0-9a-f-]{36}$/i.test(jobId)) return "/messages";
  const jobs = { OR: [{ customerId: viewer.userId }, { workerId: viewer.userId }], ...(jobId ? { id: jobId } : {}) };
  const thread = await db.supportThread.findFirst({ where: { jobParticipants: true, job: { is: jobs } }, orderBy: { lastMessageAt: "desc" }, select: { id: true } });
  if (thread) return `/messages/${thread.id}`;
  if (jobId && await db.job.count({ where: jobs })) return `/messages?job=${encodeURIComponent(jobId)}`;
  return "/messages";
}
