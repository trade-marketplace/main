import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { suburbKey, waitlistInput, type WaitlistResult } from "@/lib/waitlist";
import { getDb } from "@/server/db";

export type WaitlistStore = Pick<PrismaClient, "waitlistEntry">;

/** Insert first: the unique key also handles simultaneous requests without replacing the first entry. */
export async function saveWaitlist(
  input: unknown,
  database: () => WaitlistStore | null = () => process.env.DATABASE_URL?.trim() ? getDb() : null,
): Promise<WaitlistResult> {
  const parsed = waitlistInput.safeParse(input);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return { status: "error", ...(field === "email" || field === "suburb" ? { field } : {}) };
  }
  try {
    const db = database();
    if (!db) return { status: "error" };
    await db.waitlistEntry.create({ data: { ...parsed.data, suburbKey: suburbKey(parsed.data.suburb) } });
    return { status: "joined" };
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      return { status: "already-on-list" };
    }
    // Do not log the submitted email, suburb or a database exception containing them.
    console.error("Waitlist could not be saved.");
    return { status: "error" };
  }
}
