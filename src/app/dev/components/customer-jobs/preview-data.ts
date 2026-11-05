import { CUSTOMER_JOBS_PAGE_SIZE, customerJobAction, customerJobUpdated, type CustomerJobRow, type CustomerJobsData, type CustomerJobsQuery } from "@/lib/customer-jobs";
import { customerJobListView, type JobSummarySource } from "@/server/views/jobs";

export function previewCustomerJobs(state: string, query: CustomerJobsQuery): CustomerJobsData {
  const now = new Date("2026-11-04T12:00:00Z");
  const viewer = { userId: "11111111-1111-4111-8111-111111111131", role: "CUSTOMER" as const };
  const examples: [JobSummarySource["status"], string, JobSummarySource["category"], string | null][] = [
    ["PRICED", "Sub wiring", "ELECTRICAL", null], ["SUBMITTED", "Fix fence palings", "CONSTRUCTION", "Mere R."], ["REVIEW", "Kitchen tap leaking", "PLUMBING", null],
    ["ASSIGNED", "Hang a door", "CONSTRUCTION", "Jack W."], ["COMPLETED", "Move a couch", "OTHER", "Mere R."], ["CANCELLED", "Gutter clean", "OTHER", null],
  ];
  const rows: CustomerJobRow[] = Array.from({ length: state === "pages" ? 45 : 6 }, (_, index) => {
    const [status, title, category, tradie] = state === "pages" ? ["REVIEW" as const, `Example job ${index + 1}`, "OTHER" as const, null] : examples[index];
    const updatedAt = new Date(now.getTime() - (index + 1) * 300_000);
    const source: JobSummarySource = { id: `13100000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, jobNumber: 1000 + index, title: state === "long" ? "Repair a very long job title with details that wrap safely at every screen width without pushing the page sideways" : title,
      category, status, customerId: viewer.userId, workerId: tradie ? "22222222-2222-4222-8222-222222222131" : null, suburb: "Windsor", city: "Invercargill", asap: false,
      createdAt: updatedAt, updatedAt, priceCents: status === "REVIEW" ? null : 37200 };
    const safe = customerJobListView(viewer, source)!;
    return { ...safe, tradie, action: customerJobAction(status, state === "extra-work"), updated: customerJobUpdated(safe.updatedAt, now) };
  });
  const search = query.q.toLowerCase();
  const matches = state === "empty" ? [] : rows.filter(row => !search || row.title.toLowerCase().includes(search) || [`TM-${row.jobNumber}`, String(row.jobNumber)].some(number => number.toLowerCase() === search));
  const grouped = { active: matches.filter(row => !["COMPLETED", "CANCELLED"].includes(row.status)), done: matches.filter(row => row.status === "COMPLETED"), cancelled: matches.filter(row => row.status === "CANCELLED") };
  const selected = grouped[query.tab].sort((a, b) => Number(Boolean(b.action)) - Number(Boolean(a.action)) || b.createdAt.localeCompare(a.createdAt));
  const total = selected.length, page = Math.min(query.page, Math.max(1, Math.ceil(total / CUSTOMER_JOBS_PAGE_SIZE)));
  return { counts: { active: grouped.active.length, done: grouped.done.length, cancelled: grouped.cancelled.length }, total, page, rows: selected.slice((page - 1) * CUSTOMER_JOBS_PAGE_SIZE, page * CUSTOMER_JOBS_PAGE_SIZE) };
}
