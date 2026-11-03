import { AccountSettings } from "@/components/account/AccountSettings";
import { TradesLoading } from "@/components/account/TradesLicences";
import { requireRole } from "@/server/auth/guard";
export default async function Loading() {
  await requireRole(["TRADIE"], { next: "/profile/trades" });
  return <AccountSettings role="TRADIE" active="/profile/trades"><TradesLoading /></AccountSettings>;
}
