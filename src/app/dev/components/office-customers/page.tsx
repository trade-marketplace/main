import type { Metadata } from "next";
import { OfficeCustomers } from "@/components/office/OfficeCustomers";
import { OfficeShellView } from "@/components/office/OfficeShellView";
import { CUSTOMER_STATES, CUSTOMER_PAGE_SIZE, parseCustomersQuery, type CustomerState, type OfficeCustomer } from "@/lib/office/customers";
import { guardDevPage } from "@/server/dev-pages";
export const metadata: Metadata = { title: "Office customers (dev)", robots: { index: false, follow: false } };
const examples: OfficeCustomer[] = Array.from({ length: 27 }, (_, i) => ({ id: `24100000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`, name: i === 0 ? "Sarah Taylor" : i === 1 ? "Alex Green" : `Customer ${String(i + 1).padStart(2, "0")}`, email: i === 0 ? "sarah@example.test" : `customer${i + 1}@example.test`, mobile: i % 3 ? "+64211234567" : null, suburb: i % 4 ? "Windsor" : null, jobs: i % 5, lastJobAt: i % 5 ? "2026-11-11T01:00:00Z" : null, joinedAt: new Date(Date.UTC(2026, 10, 12 - i)).toISOString() }));
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  guardDevPage();
  const params = await searchParams, value = typeof params.state === "string" ? params.state : "list", state: CustomerState = CUSTOMER_STATES.includes(value as CustomerState) ? value as CustomerState : "list";
  const query = parseCustomersQuery({ ...params, page: params.page ?? (state === "page-2" ? "2" : "1"), sort: params.sort ?? (state === "sorted" ? "name.asc" : "joined.desc"), q: params.q ?? (state === "searching" ? "Sarah" : state === "no-match" ? "Nobody" : "") });
  const q = query.q.toLowerCase(), rows = (state === "empty" ? [] : examples).filter(row => `${row.name} ${row.email} ${row.mobile || ""}`.toLowerCase().includes(q));
  const { key = "joined", direction = "desc" } = query.sort ?? {}, sign = direction === "asc" ? 1 : -1;
  rows.sort((a, b) => { const x = key === "jobs" ? a.jobs : key === "lastJob" ? a.lastJobAt : key === "name" ? a.name : a.joinedAt, y = key === "jobs" ? b.jobs : key === "lastJob" ? b.lastJobAt : key === "name" ? b.name : b.joinedAt; return x === y ? a.id.localeCompare(b.id) : x === null ? 1 : y === null ? -1 : (x < y ? -1 : 1) * sign; });
  const data = state === "error" || state === "loading" ? null : { query, rows: rows.slice((query.page - 1) * CUSTOMER_PAGE_SIZE, query.page * CUSTOMER_PAGE_SIZE), total: rows.length };
  return <OfficeShellView viewer={{ role: "ADMIN", firstName: "Matt", lastName: "Larsen", email: "office@demo.test" }} counts={{ queues: 0, tradies: 0, support: 0 }} testMode preview={{ at: "/admin/customers", base: "/dev/components/office-customers" }}><OfficeCustomers query={query} data={data} base="/dev/components/office-customers" loading={state === "loading"} offline={state === "offline"} /></OfficeShellView>;
}
