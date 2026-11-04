import "server-only";

import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Guards } from "@/server/auth/guard";

type Dependencies = { authorize: Guards["authorize"]; db: () => Pick<PrismaClient, "job"> };
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

/** A revision check never loads the full job or signs files. Ownership is part of the database predicate. */
export function createCustomerJobRevisionRoute({ authorize, db }: Dependencies) {
  return async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const auth = await authorize(["CUSTOMER"]);
      if (!auth.ok) return reply({ error: auth.error }, auth.error === "session-expired" ? 401 : 403);
      if (auth.viewer.role !== "CUSTOMER") return reply({ error: "forbidden" }, 403);
      const { id } = await params;
      if (!z.uuid().safeParse(id).success) return reply({ error: "not-found" }, 404);
      const job = await db().job.findFirst({ where: { id, customerId: auth.viewer.userId }, select: { updatedAt: true, status: true } });
      return job ? reply({ revision: job.updatedAt.toISOString(), status: job.status }) : reply({ error: "not-found" }, 404);
    } catch { return reply({ error: "unavailable" }, 503); }
  };
}
