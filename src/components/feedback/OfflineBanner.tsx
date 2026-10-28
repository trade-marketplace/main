"use client";
// The offline banner and its hook (#79, G04). Persistent red banner across the top of the page while the browser
// is offline: "You're offline. We'll keep trying. Anything you've typed is saved." with Retry now. While offline it
// retries by itself with backoff (2s, 4s, 8s … up to 30s), and once more as soon as the connection comes back,
// then says "You're back online." for a few seconds. Skeletons stay where they are; actions that need the
// network should disable with a reason (<Button disabled="You're offline">).
//
//   const online = useOnlineStatus();                        anywhere: true / false
//   <OfflineBanner onRetry={() => router.refresh()} />       top of a page or layout
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";

import { LiveMessage } from "./LiveMessage";
import styles from "./feedback.module.css";

export const RETRY_FIRST_MS = 2000;
export const RETRY_MAX_MS = 30_000;
/** How long "You're back online." stays up. */
export const BACK_ONLINE_MS = 4000;

/** The wait before automatic retry number `attempt` (0, 1, 2 …): 2s, 4s, 8s, 16s, then 30s each time. */
export function retryDelayMs(attempt: number): number {
  const n = Math.max(0, Math.floor(attempt));
  return Math.min(RETRY_MAX_MS, RETRY_FIRST_MS * 2 ** Math.min(n, 10));
}

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/**
 * True while the browser thinks it's online (navigator.onLine), updated on the online/offline events.
 * Always true on the server and while hydrating, so server HTML never shows the banner.
 */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
}

export type OfflineBannerProps = {
  /**
   * Fetch again: called by Retry now, on a backoff timer while offline, and once when the connection is back.
   * Without it there's no Retry now, and the banner says only "You're offline. Anything you've typed is saved."
   */
  onRetry?: () => unknown;
  /** Override the browser's status (for previews and tests). Leave it out in real pages. */
  online?: boolean;
  /**
   * Stick to the top of the page while it scrolls. Default true. A sticky banner is the page's own, so it is also a
   * labelled region ("Connection") and its text is inside a landmark. Previews inside a page pass false.
   */
  sticky?: boolean;
  className?: string;
};

export function OfflineBanner({ onRetry, online: forced, sticky = true, className }: OfflineBannerProps) {
  const browserOnline = useOnlineStatus();
  const online = forced ?? browserOnline;

  // The latest onRetry, so a new function on every render doesn't restart the backoff.
  const retryRef = useRef(onRetry);
  useEffect(() => {
    retryRef.current = onRetry;
  }, [onRetry]);

  // "Back online" shows after an offline spell, not on the first visit. Tracked as state during render (React's
  // "storing information from previous renders" pattern), so it needs no effect.
  const [wasOffline, setWasOffline] = useState(!online);
  // Counts reconnections; null while the "back online" banner isn't showing.
  const [backSince, setBackSince] = useState<number | null>(null);
  const [reconnects, setReconnects] = useState(0);
  // Speak only when the status changes while the banner is in the page. Server HTML is always "online", so a page
  // opened while offline still counts as a change once it hydrates; a banner that is offline from its very first
  // render (a preview) stays quiet, as does a page that simply re-renders.
  const [changed, setChanged] = useState(false);
  if (!online && !wasOffline) {
    setWasOffline(true);
    setBackSince(null);
    setChanged(true);
  }
  if (online && wasOffline) {
    setWasOffline(false);
    setReconnects(reconnects + 1);
    setBackSince(reconnects + 1);
    setChanged(true);
  }

  // Automatic retries while offline, waiting longer each time.
  const hasRetry = Boolean(onRetry);
  useEffect(() => {
    if (online || !hasRetry) return;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout>;
    const next = () => {
      timer = setTimeout(() => {
        retryRef.current?.();
        attempt += 1;
        next();
      }, retryDelayMs(attempt));
    };
    next();
    return () => clearTimeout(timer);
  }, [online, hasRetry]);

  // Back online: fetch once straight away, then hide the good-news banner after a few seconds.
  useEffect(() => {
    if (backSince === null) return;
    retryRef.current?.();
    const timer = setTimeout(() => setBackSince(null), BACK_ONLINE_MS);
    return () => clearTimeout(timer);
  }, [backSince]);

  const classes = [styles.banner, styles.offline, className].filter(Boolean).join(" ");
  let banner = null;
  let say: string | null = null;
  if (!online) {
    say = "Offline.";
    banner = (
      <div className={`${classes} ${styles.alert}`} data-offline="true">
        <span className={styles.bannerText}>
          <Icon name="wifi_off" decorative />
          <span>
            <b>Offline.</b>
          </span>
        </span>
        {hasRetry && (
          <Button variant="tertiary" onClick={() => retryRef.current?.()} className={styles.bannerAction}>
            Retry
          </Button>
        )}
      </div>
    );
  } else if (backSince !== null) {
    say = "Back online.";
    banner = (
      <div className={`${classes} ${styles.good}`}>
        <span className={styles.bannerText}>
          <Icon name="wifi" decorative />
          <span>
            <b>Back online.</b>
          </span>
        </span>
      </div>
    );
  }

  // The live region is always in the page (even while online), so screen readers notice the first change.
  const live = <LiveMessage message={changed ? say : null} />;
  if (sticky) {
    return (
      <section aria-label="Connection" className={styles.sticky}>
        {banner}
        {live}
      </section>
    );
  }
  return (
    <>
      {banner}
      {live}
    </>
  );
}
