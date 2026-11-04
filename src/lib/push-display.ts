/** Used by both foreground messages and the background worker; the server owns the once-only display claim. */
export async function displayPriceReady(registration: Pick<ServiceWorkerRegistration, "showNotification">, deliveryId: unknown) {
  if (typeof deliveryId !== "string" || !/^[\da-f-]{36}$/i.test(deliveryId)) return;
  const response = await fetch(`/api/notifications/push/${deliveryId}/display`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: "{}" });
  if (response.status !== 200) return;
  const message = await response.json();
  if (typeof message.title !== "string" || message.title.length > 200 || typeof message.body !== "string" || message.body.length > 200 || typeof message.href !== "string" || typeof message.tag !== "string") return;
  const target = new URL(message.href, globalThis.location.origin);
  if (target.origin !== globalThis.location.origin || !/^\/jobs\/[\da-f-]{36}$/i.test(target.pathname) || target.search || target.hash) return;
  await registration.showNotification(message.title, { body: message.body, tag: message.tag, icon: "/icons/icon-192.png", data: { href: target.href } });
}
