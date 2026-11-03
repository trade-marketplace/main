import type { Trade } from "@/generated/prisma/client";
import { Icon } from "@/components/Icon";
import styles from "./verified-badge.module.css";

export type VerifiedBadgeProps = {
  /** Computed by the server's isVerified(), never from a legacy flag or a browser assertion. */
  verified: boolean;
  /** A restricted-trade badge says exactly what was checked; Other has no licence claim. */
  trade?: Trade;
};

export function VerifiedBadge({ verified, trade }: VerifiedBadgeProps) {
  if (!verified) return null;
  return <span className={styles.badge}><Icon name="verified" fill decorative className={styles.icon} /><span>{trade && trade !== "OTHER" ? "Licence checked" : "Verified"}</span></span>;
}
