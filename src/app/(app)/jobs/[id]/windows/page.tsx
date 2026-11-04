import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JobWindows, JobWindowsLoadError } from "@/components/jobs/JobWindows";
import { privateMetadata } from "@/lib/metadata";
import { requireRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { loadJobWindows } from "@/server/jobs/windows";
export const metadata: Metadata = { ...privateMetadata, title: "When do you need it?" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const viewer = await requireRole(["CUSTOMER"], { next: `/jobs/${id}/windows` });
  let initial;
  try { initial = await loadJobWindows(getDb(), viewer, id); } catch { return <JobWindowsLoadError />; }
  if (!initial) notFound();
  return <JobWindows initial={initial} initialNow={new Date().toISOString()} />;
}
