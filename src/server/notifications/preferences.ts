import "server-only";

import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import { PREFERENCE_CHANNELS, preferenceDefinitions, preferenceSnapshot, type PreferenceRole, type PreferenceSaveResult } from "@/lib/notification-preferences";

export type PreferencesDb = Pick<Prisma.TransactionClient, "notificationPreference">;
const changeSchema = z.object({ event: z.string().max(80), channel: z.enum(PREFERENCE_CHANNELS), enabled: z.boolean() }).strict();

export async function loadPreferences(db: PreferencesDb, userId: string, role: PreferenceRole) {
  const saved = await db.notificationPreference.findMany({ where: { userId }, select: { event: true, channel: true, enabled: true } });
  return preferenceSnapshot(role, saved);
}

/** Identity and role come only from the checked session. The browser supplies one absolute, retry-safe choice. */
export async function savePreference(db: PreferencesDb, userId: string, role: PreferenceRole, input: unknown): Promise<PreferenceSaveResult> {
  const parsed = changeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const change = parsed.data;
  const definition = preferenceDefinitions(role).find(row => row.event === change.event);
  if (!definition) return { ok: false, error: "invalid" };
  if (definition.locks?.[change.channel] !== undefined) return { ok: false, error: "locked" };
  const saved = await db.notificationPreference.upsert({
    where: { userId_event_channel: { userId, event: change.event, channel: change.channel } },
    create: { userId, ...change }, update: { enabled: change.enabled },
    select: { event: true, channel: true, enabled: true },
  });
  return { ok: true, change: saved };
}
