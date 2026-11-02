"use client";
// The one offline banner for the whole app (#187, G04), mounted once in the root layout (src/app/layout.tsx) so
// every page has it: public, customer, tradie and office. It is the shared <OfflineBanner> (#79) stuck to the top of
// the page, plus two things the issue asks for:
//
//  - A form submitted while offline is kept, not lost. Its fields stay exactly as typed (the page isn't touched), the
//    submit is held back, and when the connection is back the banner offers "Send now" (we never send on our own:
//    it may be a payment or a booking). Opt a form out with data-offline-queue="off".
//  - It tells the shell below how tall it is (--trade-offline-h), so sticky headers sit under the banner rather
//    than over it.
//
// Pages with their own <OfflineBanner> that just follows the browser show nothing extra (GlobalBannerContext).
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/Button";

import { LiveMessage } from "./LiveMessage";
import { GlobalBannerContext, OfflineBanner, useOnlineStatus } from "./OfflineBanner";
import styles from "./feedback.module.css";

export const OFFLINE_HEIGHT_VAR = "--trade-offline-h";
export const QUEUED_OFFLINE_TEXT = "Not sent yet. We’ll offer to send it when you’re back online.";
export const QUEUED_ONLINE_TEXT = "Not sent yet.";
const QUEUED_ONLINE_SAY = "You’re back online. Your form hasn’t been sent. Use Send now.";

type Held = { form: HTMLFormElement; submitter: HTMLElement | null };

/** Send a held form again, as if the person had pressed the same button. False if the form is gone from the page. */
export function resubmit({ form, submitter }: Held): boolean {
  if (!form.isConnected) return false;
  const button = submitter?.isConnected && submitter.closest("form") === form ? submitter : null;
  try {
    form.requestSubmit(button as HTMLButtonElement | HTMLInputElement | null);
  } catch {
    form.requestSubmit();
  }
  (button ?? form.querySelector<HTMLElement>("[type=submit]"))?.focus();
  return true;
}

/** The "Not sent yet" strip under the offline banner. Presentational; <ConnectionBanner> feeds it. */
export function HeldFormBar({ online, onSend, onDismiss }: { online: boolean; onSend?: () => void; onDismiss?: () => void }) {
  return (
    <div className={styles.held} data-held-form="true">
      <span>{online ? QUEUED_ONLINE_TEXT : QUEUED_OFFLINE_TEXT}</span>
      {online && (
        <>
          <Button variant="tertiary" onClick={onSend} className={styles.bannerAction}>Send now</Button>
          <Button variant="tertiary" onClick={onDismiss} className={styles.bannerAction}>Not now</Button>
        </>
      )}
    </div>
  );
}

export type ConnectionBannerProps = { children?: ReactNode };

export function ConnectionBanner({ children }: ConnectionBannerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const online = useOnlineStatus();
  const [held, setHeld] = useState<Held | null>(null);
  const section = useRef<HTMLElement>(null);

  // Retry = check the server answers, then (only then) refresh server data. A plain router.refresh() while offline
  // falls back to a full page load, which would throw away what someone typed.
  const retry = useCallback(async () => {
    try {
      const response = await fetch(window.location.href, { method: "HEAD", cache: "no-store" });
      if (response.status < 500) router.refresh();
    } catch {
      // Still offline: the next backoff try will see.
    }
  }, [router]);

  // Hold back any form submitted while the browser is offline.
  useEffect(() => {
    const onSubmit = (event: SubmitEvent) => {
      if (navigator.onLine) return;
      const form = event.target;
      if (!(form instanceof HTMLFormElement) || form.dataset.offlineQueue === "off") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setHeld({ form, submitter: event.submitter });
    };
    document.addEventListener("submit", onSubmit, true);
    return () => document.removeEventListener("submit", onSubmit, true);
  }, []);

  // Moving to another page drops the held form (it is gone from the screen with the page).
  const [heldPath, setHeldPath] = useState(pathname);
  if (heldPath !== pathname) {
    setHeldPath(pathname);
    if (held) setHeld(null);
  }

  // Sticky headers in the shells sit below the banner: publish its height while it is showing.
  useEffect(() => {
    const el = section.current;
    if (!el) return;
    const root = document.documentElement;
    const measure = () => {
      const h = Math.round(el.getBoundingClientRect().height);
      if (h > 0) root.style.setProperty(OFFLINE_HEIGHT_VAR, `${h}px`);
      else root.style.removeProperty(OFFLINE_HEIGHT_VAR);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty(OFFLINE_HEIGHT_VAR);
    };
  }, []);

  const send = () => {
    if (held) resubmit(held);
    setHeld(null);
  };

  return (
    <>
      <section ref={section} aria-label="Connection" className={styles.sticky}>
        <OfflineBanner sticky={false} onRetry={retry} />
        {held && <HeldFormBar online={online} onSend={send} onDismiss={() => setHeld(null)} />}
        <LiveMessage message={held ? (online ? QUEUED_ONLINE_SAY : QUEUED_OFFLINE_TEXT) : null} />
      </section>
      <GlobalBannerContext.Provider value>{children}</GlobalBannerContext.Provider>
    </>
  );
}
