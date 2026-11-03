"use client";
import { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { Skeleton } from "@/components/feedback/Skeleton";
import { Banner } from "@/components/overlays/Banner";
import { PUSH_ENABLED_EVENT, PUSH_NOTICE, PUSH_WORKER_PATH, type FirebaseWebConfig, type PushCardState } from "@/lib/browser-push";
import { onceStore } from "@/lib/motion/once";
import { prepareBrowserPushAction, registerBrowserPushAction } from "@/server/notifications/push-actions";
import { useOptionalSessionExpired } from "@/components/auth/SessionExpired";
import styles from "./posted-job.module.css";

export function PushOptIn({ ownerId, config, previewState }: { ownerId: string; config: FirebaseWebConfig | null; previewState?: PushCardState }) {
  const titleId = useId();
  const [state, setState] = useState<PushCardState>(previewState ?? "loading"); const [hidden, setHidden] = useState(false);
  const pending = useRef(false); const entered = useRef(false); const prompted = useRef(false); const session = useOptionalSessionExpired();
  const onceKey = `posted-notification-card:${ownerId}`;
  const enter = useEffectEvent(() => {
    if (previewState || entered.current) return; entered.current = true;
    if (onceStore.hasRun(onceKey)) { setHidden(true); return; }
    if (!config) { setState("unavailable"); return; }
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) { setState("unsupported"); return; }
    onceStore.claim(onceKey);
    setState(Notification.permission === "denied" ? "denied" : "ready");
  });
  useEffect(() => { queueMicrotask(() => enter()); }, []);
  async function enable() {
    if (pending.current) return;
    if (previewState) { setState("enabled"); return; }
    if (!config) return;
    pending.current = true; setState("requesting");
    try {
      // This native call is inside the user's own Yes-please gesture, never an effect/page load.
      let permission = Notification.permission;
      if (permission === "default") {
        if (prompted.current) { setHidden(true); return; }
        prompted.current = true; permission = await Notification.requestPermission();
      }
      if (permission === "default") { setHidden(true); return; }
      if (permission !== "granted") { setState("denied"); return; }
      const prepared = await prepareBrowserPushAction(ownerId);
      if (session?.check(prepared, { resend: enable })) return;
      if (!("status" in prepared) || prepared.status !== "ready") { setState("error"); return; }
      const [{ initializeApp, getApps }, { getMessaging, getToken, isSupported }] = await Promise.all([import("firebase/app"), import("firebase/messaging")]);
      if (!await isSupported()) { setState("unsupported"); return; }
      const registration = await navigator.serviceWorker.register(PUSH_WORKER_PATH, { scope: "/" });
      await navigator.serviceWorker.ready;
      const app = getApps().find(value => value.name === "trade-push") ?? initializeApp(config, "trade-push");
      const token = await getToken(getMessaging(app), { vapidKey: config.vapidKey, serviceWorkerRegistration: registration });
      const result = await registerBrowserPushAction(ownerId, token);
      if (session?.check(result, { resend: enable })) return;
      if (!("status" in result) || result.status !== "enabled") { setState("error"); return; }
      setState("enabled"); window.dispatchEvent(new Event(PUSH_ENABLED_EVENT));
    } catch { setState("error"); }
    finally { pending.current = false; }
  }
  if (hidden) return null;
  const notice = state === "denied" ? PUSH_NOTICE.denied : state === "unavailable" || state === "unsupported" ? PUSH_NOTICE.unavailable : state === "error" ? PUSH_NOTICE.error : null;
  return <section className={styles.optIn} aria-labelledby={titleId}>
    <h2 id={titleId}><Icon name="notifications_active" decorative />Get a ping when it’s ready?</h2>
    <p>Browser notifications. You can turn them off any time.</p>
    {state === "loading" ? <div role="status" aria-label="Loading notifications"><Skeleton height={40} /></div> : state === "enabled" ? <Banner tone="good" title="Notifications are on." live /> : <>
      {notice && <Banner tone={state === "error" ? "alert" : "info"} live>{notice}</Banner>}
      <div className={styles.optInActions}>
        <Button variant="secondary" size="sm" width="auto" onClick={() => void enable()} loading={state === "requesting"} disabled={state === "denied" || state === "unavailable" || state === "unsupported"}>{state === "error" ? "Try again" : "Yes please"}</Button>
        <Button variant="tertiary" size="sm" width="auto" disabled={state === "requesting"} onClick={() => { onceStore.claim(onceKey); setHidden(true); }}>Not now</Button>
      </div>
    </>}
  </section>;
}
