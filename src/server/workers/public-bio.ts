import "server-only";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { bioError } from "@/components/account/public-bio-validation";
import { createAudit } from "@/server/audit/audit";
import type { Viewer } from "@/server/auth/viewer";
import { databaseSchema } from "@/server/database-client";

export type SaveBioResult = { ok: true; bio: string } | { ok: false; error: "forbidden" | "invalid" | "session-expired" | "unavailable" };

export async function saveBio(db: PrismaClient, viewer: Pick<Viewer, "userId" | "role">, input: unknown): Promise<SaveBioResult> {
  if (viewer.role !== "TRADIE") return { ok: false, error: "forbidden" };
  if (typeof input !== "string" || bioError(input)) return { ok: false, error: "invalid" };
  const bio = input.trim() || null;
  const schema = Prisma.raw(`"${databaseSchema(db).replaceAll('"', '""')}"`);
  return db.$transaction(async tx => {
    // Concurrent retries and role changes must see the last committed profile before writing the audit.
    const [current] = await tx.$queryRaw<{ bio: string | null }[]>`
      SELECT wp.bio FROM ${schema}.profiles p JOIN ${schema}.worker_profiles wp ON wp.user_id = p.id
      WHERE p.id = ${viewer.userId}::uuid AND p.role = 'TRADIE' FOR UPDATE OF p, wp
    `;
    if (!current) return { ok: false, error: "forbidden" } as const;
    if (current.bio !== bio) {
      await tx.workerProfile.update({ where: { userId: viewer.userId }, data: { bio } });
      await createAudit(tx)(viewer, "worker.bio_updated", { type: "worker_profiles", id: viewer.userId }, { bio: current.bio }, { bio });
    }
    return { ok: true, bio: bio ?? "" } as const;
  });
}
