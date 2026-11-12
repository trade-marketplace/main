import { unstable_rethrow } from "next/navigation";
import { Suspense } from "react";
import { CustomerJobs } from "@/components/jobs/CustomerJobs";
import { MyWork } from "@/components/mywork/MyWork";
import { myWorkHref, myWorkReturn, parseMyWorkQuery, type MyQuotesData, type MyWorkData, type MyWorkQuery } from "@/lib/my-work";
import { customerJobsHref, parseCustomerJobsQuery, type CustomerJobsData, type CustomerJobsQuery } from "@/lib/customer-jobs";
import { privateMetadata } from "@/lib/metadata";
import { requireRole } from "@/server/auth/guard";
import { listCustomerJobs } from "@/server/customer-jobs";
import { getDb } from "@/server/db";
import { getViewer } from "@/server/auth/viewer";
import { loadMyQuotes, loadMyWork } from "@/server/workers/my-work";
import type { JobViewer } from "@/server/views";

export async function generateMetadata() {
  const viewer = await getViewer();
  return { ...privateMetadata, title: viewer?.role === "TRADIE" ? "My work" : "My jobs" };
}
export default async function Dashboard({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const search = await searchParams;
  const query = parseCustomerJobsQuery(search), workQuery = parseMyWorkQuery(search);
  const viewer = await requireRole(["CUSTOMER", "TRADIE"], { next: myWorkReturn(myWorkHref(workQuery)) ?? customerJobsHref(query) });
  if (viewer.role === "TRADIE") return <Suspense fallback={<MyWork query={workQuery} work={null} quotes={null} loading />}><WorkerList viewer={viewer} query={workQuery} /></Suspense>;
  // Stream only after role validation: an unauthorized visitor must receive an actual 404 response.
  return <Suspense fallback={<CustomerJobs query={query} data={null} loading />}><CustomerList viewer={viewer} query={query} /></Suspense>;
}
async function WorkerList({ viewer, query }: { viewer: JobViewer; query: MyWorkQuery }) {
  let work: MyWorkData | null = null, quotes: MyQuotesData | null = null;
  try {
    const db = getDb();
    const results = await Promise.allSettled([loadMyWork(db, viewer), loadMyQuotes(db, viewer)]);
    for (const result of results) if (result.status === "rejected") unstable_rethrow(result.reason);
    if (results[0].status === "fulfilled") work = results[0].value;
    if (results[1].status === "fulfilled") quotes = results[1].value;
    if (!work || !quotes) console.error("My work could not load jobs or quotes.");
  } catch (error) { unstable_rethrow(error); console.error("My work could not load jobs or quotes."); }
  return <MyWork query={query} work={work} quotes={quotes} now={new Date().toISOString()} />;
}
async function CustomerList({ viewer, query }: { viewer: JobViewer; query: CustomerJobsQuery }) {
  let data: CustomerJobsData | null = null;
  try { data = await listCustomerJobs(getDb(), viewer, query); }
  catch (error) { unstable_rethrow(error); console.error("My jobs could not load jobs."); }
  return <CustomerJobs query={query} data={data} />;
}
