import "server-only";
import type { Prisma } from "@/generated/prisma/client";

/** Schema-aware row lock without inventing job activity. The flag never grants authorization. */
export async function lockJobWindows(tx: Prisma.TransactionClient, id: string) {
  await tx.$executeRaw`SELECT set_config('app.job_windows_lock', '1', true)`;
  const locked = await tx.job.updateMany({ where: { id }, data: { updatedAt: new Date() } });
  await tx.$executeRaw`SELECT set_config('app.job_windows_lock', '', true)`;
  return locked.count === 1;
}
