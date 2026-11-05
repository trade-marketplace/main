import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CustomerProblem, CustomerProblemLoadError } from "@/components/jobs/CustomerProblem";
import { privateMetadata } from "@/lib/metadata";
import { customerProblemReturn } from "@/lib/customer-problem";
import { requireRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { loadCustomerProblem } from "@/server/jobs/customer-problem";

export const metadata: Metadata = { ...privateMetadata, title: "Report a problem" };
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ report?: string; from?: unknown }> }) {
  const { id } = await params, search = await searchParams;
  const backHref = customerProblemReturn(id, search.from);
  const viewer = await requireRole(["CUSTOMER"], { next: `/jobs/${id}/problem${backHref === `/jobs/${id}` ? "" : `?from=${encodeURIComponent(backHref)}`}` });
  let initial;
  try { initial = await loadCustomerProblem(getDb(), viewer, id, search.report); }
  catch { return <CustomerProblemLoadError backHref={backHref} />; }
  if (!initial) notFound();
  return <CustomerProblem key={search.report ?? id} job={initial.job} initialReport={initial.report} backHref={backHref} />;
}
