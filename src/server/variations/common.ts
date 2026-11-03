import "server-only";

import type { Prisma, PrismaClient, Role } from "@/generated/prisma/client";

export type VariationActor = { userId: string };
export type VariationError = "invalid" | "not-found" | "forbidden" | "not-in-progress" | "changed" | "photos-pending" | "payment-pending" | "unavailable";
export type VariationFailure = { ok: false; error: VariationError };
export class VariationRefusal extends Error {
  constructor(readonly error: VariationError) { super(error); }
}
export const refuse = (error: VariationError): never => { throw new VariationRefusal(error); };
export const isUuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export type Tx = Prisma.TransactionClient;
export async function requireActor(tx: Tx, actor: VariationActor, role: Role) {
  if (!isUuid(actor.userId)) refuse("forbidden");
  const profile = await tx.profile.findUnique({ where: { id: actor.userId }, select: { role: true } });
  if (profile?.role !== role) refuse("forbidden");
}

/** Same row lock as job status changes/reassignment. Refusals roll back the lock write as well. */
export async function lockJob(tx: Tx, jobId: string) {
  if (!isUuid(jobId)) refuse("invalid");
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`variation-photos:${jobId}`}, 0))`;
  if ((await tx.job.updateMany({ where: { id: jobId }, data: { updatedAt: new Date() } })).count !== 1) refuse("not-found");
  return tx.job.findUniqueOrThrow({ where: { id: jobId }, select: { id: true, jobNumber: true, customerId: true, workerId: true, status: true } });
}
export async function lockVariation(tx: Tx, id: string) {
  if (!isUuid(id)) refuse("invalid");
  const initial = await tx.variation.findUnique({ where: { id }, select: { jobId: true } });
  if (!initial) return refuse("not-found");
  const job = await lockJob(tx, initial.jobId);
  const variation = await tx.variation.findUnique({ where: { id } });
  if (!variation) return refuse("not-found");
  return { job, variation };
}
export function inProgress(status: string) { if (status !== "ASSIGNED") refuse("not-in-progress"); }
export async function command<T>(db: PrismaClient, run: (tx: Tx) => Promise<T>): Promise<T | VariationFailure> {
  try { return await db.$transaction(run, { timeout: 30_000 }); }
  catch (error) { if (error instanceof VariationRefusal) return { ok: false, error: error.error }; throw error; }
}
