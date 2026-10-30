import { AccountSettings } from "@/components/account/AccountSettings";
import { PreferencesLoading } from "@/components/account/NotificationPreferences";
import styles from "@/components/account/account.module.css";
import { requireRole } from "@/server/auth/guard";

export default async function Loading() {
  const viewer = await requireRole(["CUSTOMER", "TRADIE"], { next: "/profile/notifications" });
  return <AccountSettings role={viewer.role === "TRADIE" ? "TRADIE" : "CUSTOMER"} active="/profile/notifications">
    <h1 className={styles.title}>Notifications</h1><PreferencesLoading />
  </AccountSettings>;
}
