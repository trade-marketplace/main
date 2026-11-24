import { notFound, unstable_rethrow } from "next/navigation";
import type { ReactNode } from "react";
import { z } from "zod";
import { getDb } from "@/server/db";

export default async function Layout({ params, children }: { params: Promise<{ id: string }>; children: ReactNode }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success || !process.env.DATABASE_URL?.trim()) notFound();
  // Decide the HTTP status before streaming. Leave aggregates, reviews and avatar signing to the page below its loading boundary.
  try {
    const eligible = await getDb().workerProfile.findFirst({
      where: { userId: id, verifiedAt: { not: null }, pausedAt: null, user: { role: "TRADIE" } },
      select: { userId: true },
    });
    if (!eligible) notFound();
  } catch (error) {
    // Preserve Next's 404. A transient read failure can retry inside the page's error boundary.
    unstable_rethrow(error);
  }
  return children;
}
