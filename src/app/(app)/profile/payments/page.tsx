import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccountSettings } from "@/components/account/AccountSettings";
import { PaymentsList } from "@/components/account/PaymentsList";
import { privateMetadata } from "@/lib/metadata";
import { requireUser } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { listCustomerPayments } from "@/server/account/payments-list";

export const metadata: Metadata = { ...privateMetadata, title: "Payments" };
export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const viewer = await requireUser({ next: "/profile/payments" });
  if (viewer.role !== "CUSTOMER") notFound();
  const page = Number((await searchParams).page ?? 1);
  let data = null;
  try { data = await listCustomerPayments(getDb(), viewer, page); } catch { /* Show a retryable section without exposing database errors. */ }
  return <AccountSettings role="CUSTOMER" active="/profile/payments"><PaymentsList data={data} /></AccountSettings>;
}
