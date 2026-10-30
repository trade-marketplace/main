"use client";

import { useRef } from "react";

import { NotificationPreferences, type PreferencesPreview } from "@/components/account/NotificationPreferences";
import { preferenceSnapshot, type PreferenceRole, type PreferenceSource } from "@/lib/notification-preferences";

/** Guarded, in-memory UI fixture. Never reads a database or sends a notification. */
export function PreferencesDemo({ role, state }: { role: PreferenceRole; state: string }) {
  const attempts = useRef(0);
  const snapshot = preferenceSnapshot(role, []);
  const source: PreferenceSource = {
    load: async () => ({ ok: true, snapshot }),
    save: async change => {
      attempts.current++;
      if (state === "saving" || state === "rapid") await new Promise(resolve => setTimeout(resolve, 2000));
      if (state === "expired") return { ok: false, error: "session-expired" };
      if ((state === "save-error" || state === "failure") && attempts.current === 1) return { ok: false, error: "unavailable" };
      return { ok: true, change };
    },
  };
  return <NotificationPreferences source={source} initial={state === "error" ? { ok: false, error: "unavailable" } : { ok: true, snapshot: state === "empty" ? { rows: [] } : snapshot }}
    preview={["loading", "saving", "offline", "saved", "save-error", "expired"].includes(state) ? state as PreferencesPreview : undefined} />;
}
