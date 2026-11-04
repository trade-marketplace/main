import { initializeApp, type FirebaseOptions } from "firebase/app";
import { getMessaging, onBackgroundMessage } from "firebase/messaging/sw";
import { displayPriceReady } from "../lib/push-display";

type WorkerEvent = { notification?: Notification; data?: unknown; waitUntil(task: Promise<unknown>): void };
type WorkerContext = {
  __TRADE_FIREBASE_CONFIG__?: FirebaseOptions;
  registration: ServiceWorkerRegistration;
  location: Location;
  clients: { matchAll(options: { type: "window"; includeUncontrolled: boolean }): Promise<{ url: string; focus(): Promise<unknown> }[]>; openWindow(url: string): Promise<unknown> };
  addEventListener(type: string, handler: (event: WorkerEvent) => void): void;
};
const scope = globalThis as unknown as WorkerContext;
// Register our click handler before Firebase installs its listeners. Only same-origin job links can open.
scope.addEventListener("notificationclick", event => {
  const href = event.notification?.data?.href; event.notification?.close();
  if (typeof href !== "string") return;
  const target = new URL(href, scope.location.origin);
  if (target.origin !== scope.location.origin || !/^\/jobs\/[\da-f-]{36}$/i.test(target.pathname) || target.search || target.hash) return;
  event.waitUntil(scope.clients.matchAll({ type: "window", includeUncontrolled: true }).then(clients => {
    const existing = clients.find(client => client.url === target.href);
    return existing ? existing.focus() : scope.clients.openWindow(target.href);
  }));
});
if (scope.__TRADE_FIREBASE_CONFIG__) {
  const messaging = getMessaging(initializeApp(scope.__TRADE_FIREBASE_CONFIG__));
  onBackgroundMessage(messaging, payload => displayPriceReady(scope.registration, payload.data?.deliveryId).catch(() => {}));
}
