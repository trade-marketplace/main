import { notFound, unstable_rethrow } from "next/navigation";
import { CustomerJobs } from "@/components/jobs/CustomerJobs";
import { customerJobsHref, parseCustomerJobsQuery, type CustomerJobsData } from "@/lib/customer-jobs";
import { privateMetadata } from "@/lib/metadata";
import { requireRole } from "@/server/auth/guard";
import { listCustomerJobs } from "@/server/customer-jobs";
import { getDb } from "@/server/db";

export const metadata = { ...privateMetadata, title: "My jobs" };
export default async function Dashboard({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = parseCustomerJobsQuery(await searchParams);
  const viewer = await requireRole(["CUSTOMER", "TRADIE"], { next: customerJobsHref(query) });
  // /dashboard is shared with My work (#148). Until then, workers retain its existing404.
  if (viewer.role !== "CUSTOMER") notFound();
  let data: CustomerJobsData | null = null;
  try { data = await listCustomerJobs(getDb(), viewer, query); }
  catch (error) { unstable_rethrow(error); console.error("My jobs could not load jobs."); }
  return <CustomerJobs query={query} data={data} />;
}
