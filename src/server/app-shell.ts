// What the signed-in app shell (#84) needs from the server: the person's name for the avatar, their unread
// notification count for the bell, and whether payments are in test mode. Only these reach the browser (never the
// user id); the email is shown only to its owner, in their own avatar menu.
import "server-only";

import { cache } from "react";

import type { ShellViewer } from "@/components/app/AppShellView";
import { isAppRole } from "@/components/app/app-links";
import { DatabaseNotConfiguredError, getDb } from "@/server/db";
import type { Viewer } from "@/server/auth/viewer";

export type ShellExtras = { lastName: string | null; unreadNotifications: number };

/** Where the extras come from. Swapped for a fake in tests, so no test talks to a database. */
export type ShellSources = { findExtras: (userId: string) => Promise<ShellExtras | null> };

/** One query: the last name and the unread count (the notifications' partial index covers the count). */
export async function findShellExtras(userId: string): Promise<ShellExtras | null> {
  const row = await getDb().profile.findUnique({
    where: { id: userId },
    select: { lastName: true, _count: { select: { notifications: { where: { readAt: null } } } } },
  });
  return row ? { lastName: row.lastName, unreadNotifications: row._count.notifications } : null;
}

/**
 * The shell's view of a signed-in customer or tradie, or null for anyone else (the proxy keeps signed-out people
 * and the office out of app pages). If the extras can't be read, the shell still shows, with the first name only
 * and no badge: a missing count is never worth a broken page.
 */
export async function loadShellViewer(viewer: Viewer | null, sources: ShellSources): Promise<ShellViewer | null> {
  if (!viewer || !isAppRole(viewer.role)) return null;
  let extras: ShellExtras | null = null;
  try {
    extras = await sources.findExtras(viewer.userId);
  } catch (error) {
    // No database yet (local work without one): nothing to count, nothing worth logging on every page.
    if (!(error instanceof DatabaseNotConfiguredError))
      console.error("App shell: couldn't read the name and unread count; showing the first name only.", error);
  }
  return {
    role: viewer.role,
    firstName: viewer.firstName,
    lastName: extras?.lastName ?? null,
    email: viewer.email,
    emailVerified: viewer.emailVerified,
    counts: { notifications: extras?.unreadNotifications ?? 0, messages: 0 },
  };
}

export const getShellViewer = cache((viewer: Viewer | null) => loadShellViewer(viewer, { findExtras: findShellExtras }));

/**
 * Payments are in test mode until both founders agree in writing to switch them on (AGENTS.md). There is no live
 * switch yet, so this is always true; the payments work adds the real check (and William reviews it).
 */
export function paymentsInTestMode(): boolean {
  return true;
}
