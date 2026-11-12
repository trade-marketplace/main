import { AccountSettings } from "@/components/account/AccountSettings";
import { AddressesLoading } from "@/components/account/Addresses";

export default function Loading() {
  return <AccountSettings role="CUSTOMER" active="/profile/addresses"><AddressesLoading /></AccountSettings>;
}
