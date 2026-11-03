"use client";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { browserPushReceiverAction } from "@/server/notifications/push-actions";
import { PUSH_ENABLED_EVENT, PUSH_WORKER_PATH } from "@/lib/browser-push";
import { displayPriceReady } from "@/lib/push-display";

/** Only an already opted-in browser loads messaging. Every message still needs a fresh server display claim. */
export function BrowserPushReceiver() {
  const pathname = usePathname(); const owner = useRef<string | null>(null);
  useEffect(() => {
    let active = true, sequence = 0; let stop: (() => void) | undefined;
    const initialize = async () => {
      const request = ++sequence; stop?.(); stop = undefined;
      if (!("Notification" in window) || Notification.permission !== "granted" || !("serviceWorker" in navigator)) return;
      try {
        const registration = await navigator.serviceWorker.getRegistration("/");
        if (!registration?.active || new URL(registration.active.scriptURL).pathname !== PUSH_WORKER_PATH) return;
        const result = await browserPushReceiverAction();
        if (!active || request !== sequence) return;
        const nextOwner = "status" in result && result.status === "ready" ? result.ownerId : null;
        if (owner.current && owner.current !== nextOwner) for (const notification of await registration.getNotifications()) if (notification.tag.startsWith("trade-price:")) notification.close();
        owner.current = nextOwner;
        if (!("status" in result) || result.status !== "ready") return;
        const [{ initializeApp, getApps }, { getMessaging, onMessage, isSupported }] = await Promise.all([import("firebase/app"), import("firebase/messaging")]);
        if (!active || request !== sequence || !await isSupported()) return;
        const app = getApps().find(value => value.name === "trade-push") ?? initializeApp(result.config, "trade-push");
        stop = onMessage(getMessaging(app), payload => { void displayPriceReady(registration, payload.data?.deliveryId).catch(() => {}); });
      } catch { /* Optional push never blocks navigation or the durable in-app inbox. */ }
    };
    const refresh = () => { void initialize(); }; void initialize();
    window.addEventListener(PUSH_ENABLED_EVENT, refresh); window.addEventListener("focus", refresh);
    return () => { active = false; sequence++; stop?.(); window.removeEventListener(PUSH_ENABLED_EVENT, refresh); window.removeEventListener("focus", refresh); };
  }, [pathname]);
  return null;
}
