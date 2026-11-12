import { AccountSettings } from "@/components/account/AccountSettings";
import { PaymentsList } from "@/components/account/PaymentsList";

export default function Loading() {
  return <AccountSettings role="CUSTOMER" active="/profile/payments"><PaymentsList data={null} loading /></AccountSettings>;
}
