import type { Metadata } from "next";
import { notFound, unstable_rethrow } from "next/navigation";
import { OfficeCustomers } from "@/components/office/OfficeCustomers";
import { customersHref, parseCustomersQuery, type CustomersPage } from "@/lib/office/customers";
import { requireRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { listCustomers } from "@/server/office/customers";
export const metadata: Metadata = { title: "Customers" };
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = parseCustomersQuery(await searchParams), viewer = await requireRole(["ADMIN"], { next: customersHref(query) });
  let data: CustomersPage | null = null;
  try { data = await listCustomers(getDb(), viewer, query); if (!data) notFound(); } catch (error) { unstable_rethrow(error); }
  return <OfficeCustomers query={data?.query ?? query} data={data} />;
}
