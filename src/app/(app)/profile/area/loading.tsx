import { notFound } from "next/navigation";
import { AccountSettings } from "@/components/account/AccountSettings";
import { WorkAreaLoading } from "@/components/account/WorkArea";
import { requireUser } from "@/server/auth/guard";
export default async function Loading() {
  const viewer = await requireUser({ next: "/profile/area" });
  if (viewer.role !== "TRADIE") notFound();
  return <AccountSettings role="TRADIE" active="/profile/area"><WorkAreaLoading /></AccountSettings>;
}
