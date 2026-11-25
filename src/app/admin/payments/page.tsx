// /admin/payments, the office's "Payments & refunds" (#176, F11): every payment, filterable, searchable, 25 a page,
// totals, Export CSV, and Refund through the job admin's own dialog and action. The office layout already checks the
// role; this page checks again because it reads every payment.
import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";

import { OfficePayments } from "@/components/office/OfficePayments";
import { OFFICE_PAYMENTS_PATH, officePaymentsSearch, parseOfficePaymentsQuery } from "@/lib/office-payments";
import { requireRole } from "@/server/auth/guard";
import { DatabaseNotConfiguredError } from "@/server/db";
import { listOfficePayments, type OfficePaymentsPage } from "@/server/office/payments";

export const metadata: Metadata = { title: "Payments" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function PaymentsPage({ searchParams }: { searchParams: SearchParams }) {
  const query = parseOfficePaymentsQuery(await searchParams);
  const viewer = await requireRole(["ADMIN"], { next: `${OFFICE_PAYMENTS_PATH}${officePaymentsSearch(query)}` });
  let data: OfficePaymentsPage | null = null;
  try {
    data = await listOfficePayments(viewer, query);
  } catch (error) {
    unstable_rethrow(error);
    // Shown as "Can't load payments" with Try again; the details stay in the server log.
    if (!(error instanceof DatabaseNotConfiguredError)) console.error("Payments: couldn't read the payments.", error);
  }
  return <OfficePayments query={query} data={data} />;
}
