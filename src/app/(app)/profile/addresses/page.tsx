import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccountSettings } from "@/components/account/AccountSettings";
import { Addresses } from "@/components/account/Addresses";
import { privateMetadata } from "@/lib/metadata";
import { requireUser } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { listAddresses } from "@/server/account/addresses";

export const metadata: Metadata = { ...privateMetadata, title: "Addresses" };
export default async function AddressesPage() {
  const viewer = await requireUser({ next: "/profile/addresses" });
  if (viewer.role !== "CUSTOMER") notFound();
  let initial = null;
  try { initial = await listAddresses(getDb(), viewer); } catch { /* The owned reader can be retried without leaking a database error. */ }
  return <AccountSettings role="CUSTOMER" active="/profile/addresses"><Addresses key={viewer.userId} initial={initial} /></AccountSettings>;
}
