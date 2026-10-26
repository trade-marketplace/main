// Banners (#78): components.css .tm-banner. A message that stays on the page until it's no longer true:
// offline, test mode, an expired link, “Private. Nobody else sees your numbers.” For short confirmations that go
// away by themselves, use a toast instead.
//
//   <Banner tone="test" title="Test mode.">No real money moves.</Banner>
//   <Banner tone="alert" title="You’re offline." live>We’ll keep trying. Anything you’ve typed is saved.</Banner>
//   <Banner tone="info" onDismiss={hide}>Running late? Use “I’m on my way” on the job.</Banner>
import type { ReactNode } from "react";

import { IconButton } from "@/components/Button";
import { Icon } from "@/components/Icon";

import styles from "./overlays.module.css";

export type BannerTone = "info" | "good" | "alert" | "brand" | "test";

/** The icon each tone shows unless you pick another. */
export const BANNER_ICONS: Record<BannerTone, string> = {
  info: "info",
  good: "check_circle",
  alert: "error",
  brand: "bolt",
  test: "science",
};

export type BannerProps = {
  /**
   * info: blue, neutral facts. good: green, it worked. alert: red, something is wrong (offline, declined).
   * brand: the mode tint, our own tips (“Private.”). test: gold, payments are in test mode.
   */
  tone?: BannerTone;
  /** A short bold lead-in, e.g. “Test mode.” */
  title?: ReactNode;
  children?: ReactNode;
  /** A Material Symbols name, or null for none. Decorative: the words say the same. */
  icon?: string | null;
  /** A link or button after the text, e.g. <TextLink inline>Send a new one</TextLink>. */
  action?: ReactNode;
  /** Shows a × that calls this. Leave it out for banners that must stay (offline, test mode). */
  onDismiss?: () => void;
  /**
   * The banner appeared because something just happened: screen readers read it out. Alert tone interrupts
   * (role="alert"), the others wait their turn (role="status"). Leave it off for banners that are there on load.
   */
  live?: boolean;
  className?: string;
};

export function Banner({ tone = "info", title, children, icon, action, onDismiss, live = false, className }: BannerProps) {
  const name = icon === undefined ? BANNER_ICONS[tone] : icon;
  const role = live ? (tone === "alert" ? "alert" : "status") : undefined;
  return (
    <div className={[styles.banner, styles[`banner-${tone}`], className].filter(Boolean).join(" ")} role={role}>
      {name && <Icon name={name} size="sm" fill={tone === "good" || tone === "test"} decorative className={styles.bannerIcon} />}
      <p className={styles.bannerText}>
        {title && <b>{title}</b>}
        {title && children ? " " : null}
        {children}
        {action && <> {action}</>}
      </p>
      {onDismiss && (
        <span className={styles.bannerDismiss}>
          <IconButton icon="close" label="Dismiss" onClick={onDismiss} />
        </span>
      )}
    </div>
  );
}
