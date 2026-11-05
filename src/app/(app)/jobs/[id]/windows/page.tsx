import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JobWindows, JobWindowsLoadError } from "@/components/jobs/JobWindows";
import { privateMetadata } from "@/lib/metadata";
import { customerJobWindowsReturn } from "@/lib/customer-job";
import { requireRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { loadJobWindows } from "@/server/jobs/windows";
export const metadata: Metadata = { ...privateMetadata, title: "When do you need it?" };
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: unknown }> }) {
  const { id } = await params, search = await searchParams;
  const backHref = customerJobWindowsReturn(id, search.from);
  const next = `/jobs/${id}/windows${backHref === "/notifications" ? "" : `?from=${encodeURIComponent(backHref)}`}`;
  const viewer = await requireRole(["CUSTOMER"], { next });
  let initial;
  try { initial = await loadJobWindows(getDb(), viewer, id); } catch { return <JobWindowsLoadError backHref={backHref} />; }
  if (!initial) notFound();
  return <JobWindows initial={initial} initialNow={new Date().toISOString()} backHref={backHref} />;
}
