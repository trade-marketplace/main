"use client";

import { useMemo, useRef, useState } from "react";

import { BoltMark } from "@/components/BoltMark";
import { IconButton } from "@/components/Button";
import { AppShellView } from "@/components/app/AppShellView";
import { SessionExpiredProvider } from "@/components/auth/SessionExpired";
import { NotificationInboxProvider } from "@/components/notifications/NotificationInbox";
import type { InboxItem, InboxSnapshot, InboxSource } from "@/lib/notifications";

import styles from "./notifications-demo.module.css";

const NOW = Date.UTC(2026, 9, 28, 0, 0);
const id = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
function example(i: number): InboxItem {
  const examples = [
    ["Your price is ready · Sub wiring", "sell", "/jobs/TM-1005"],
    ["Jack sent a message", "chat_bubble", "/messages/TM-1005"],
    ["Fence palings are finished. Please check.", "task_alt", "/jobs/TM-1004"],
    ["Receipt for TM-0998", "receipt_long", "/receipts/TM-0998"],
  ];
  const [line, icon, href] = examples[i % examples.length];
  return { id: id(i), line, icon, href, createdAt: new Date(NOW - (i < 2 ? (5 + i * 4) * 60_000 : (i + 1) * 86_400_000)).toISOString(), readAt: i < 2 ? null : new Date(NOW - 60_000).toISOString() };
}

function fixture(state: string): InboxSnapshot {
  const items = state === "empty" ? [] : Array.from({ length: state === "many" ? 8 : 4 }, (_, i) => example(i));
  if (state === "read" || state === "success") items.forEach((row) => { row.readAt = new Date(NOW).toISOString(); });
  if (state === "many") items.forEach((row) => { row.readAt = null; });
  if (state === "long") items[0].line = "Your price is ready · Replace the entire back boundary fence beside the garage and the unusually long shared driveway";
  return { items, unread: state === "many" ? 12 : items.filter((row) => row.readAt === null).length };
}

/** Synthetic rows live behind guardDevPage. Neither this source nor these identities can reach Vercel. */
export function NotificationDemo({ state, role, controls }: { state: string; role: "CUSTOMER" | "TRADIE"; controls: boolean }) {
  const [initial] = useState(() => fixture(state));
  const server = useRef(structuredClone(initial));
  const signedIn = useRef(state !== "expired");
  const source = useMemo<InboxSource>(() => ({
    load: async () => {
      if (state === "loading") return new Promise(() => {});
      await new Promise((resolve) => setTimeout(resolve, 200));
      return { ok: true, inbox: structuredClone(server.current) };
    },
    read: async (notificationId) => {
      if (!signedIn.current) return { ok: false, error: "session-expired" };
      await new Promise((resolve) => setTimeout(resolve, 400));
      const removed = notificationId === null ? server.current.unread : server.current.items.filter((row) => row.id === notificationId && row.readAt === null).length;
      server.current = { unread: Math.max(0, server.current.unread - removed), items: server.current.items.map((row) => notificationId === null || notificationId === row.id ? { ...row, readAt: row.readAt ?? new Date(NOW).toISOString() } : row) };
      return { ok: true, inbox: structuredClone(server.current) };
    },
  }), [state]);
  const firstName = role === "TRADIE" ? "Jack" : "Sarah";
  const email = role === "TRADIE" ? "jack@example.test" : "sarah@example.test";
  return <SessionExpiredProvider email={email} role={role} logIn={async () => { signedIn.current = true; return { ok: true, role, redirectTo: role === "TRADIE" ? "/jobs" : "/" }; }}>
    <NotificationInboxProvider count={initial.unread} source={source} initialInbox={state === "loading" || state === "error" ? undefined : initial} initialError={state === "error"} initialSaving={state === "saving"} now={NOW}>
      <AppShellView testMode={false} viewer={{ role, firstName, lastName: role === "TRADIE" ? "Wilson" : "Thompson", email, emailVerified: true, counts: { notifications: initial.unread, messages: 0 } }}
        preview={{ at: role === "TRADIE" ? "/jobs" : "/", base: "/dev/components/notifications", notificationsOpen: true }}>
        <div className={styles.canvas}>
          <section className={styles.hero}><BoltMark variant="hero" className={styles.bolt} /><div className={styles.wrap}><h1>Kia ora {firstName}. What needs doing?</h1></div></section>
          {controls && <div className={styles.controls}><IconButton icon="add" label="Add notification" onClick={() => {
            server.current = { items: [{ ...example(8 + server.current.unread), readAt: null, createdAt: new Date(NOW).toISOString() }, ...server.current.items].slice(0, 8), unread: server.current.unread + 1 };
            window.dispatchEvent(new Event("focus"));
          }} /></div>}
        </div>
      </AppShellView>
    </NotificationInboxProvider>
  </SessionExpiredProvider>;
}
