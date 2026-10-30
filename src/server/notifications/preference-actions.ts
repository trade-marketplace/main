"use server";

import type { PreferenceLoadResult, PreferenceSaveResult } from "@/lib/notification-preferences";
import { withRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";

import { loadPreferences, savePreference } from "./preferences";

export const loadPreferencesAction = withRole(["CUSTOMER", "TRADIE"], async (viewer): Promise<PreferenceLoadResult> => {
  try { return { ok: true, snapshot: await loadPreferences(getDb(), viewer.userId, viewer.role === "TRADIE" ? "TRADIE" : "CUSTOMER") }; }
  catch { console.error("Notification preferences unavailable"); return { ok: false, error: "unavailable" }; }
});

export const savePreferenceAction = withRole(["CUSTOMER", "TRADIE"], async (viewer, input: unknown): Promise<PreferenceSaveResult> => {
  try { return await savePreference(getDb(), viewer.userId, viewer.role === "TRADIE" ? "TRADIE" : "CUSTOMER", input); }
  catch { console.error("Notification preference save unavailable"); return { ok: false, error: "unavailable" }; }
});
