"use client";

import { ProfileSettings, type ProfileAction } from "@/components/account/ProfileSettings";
import type { AvatarUpload } from "@/lib/account/avatar-upload";
import { parseProfile, readProfileForm } from "@/lib/account/profile";

// Isolated UI exercise: never calls the database or Storage. The real page uses saveProfileAction and /api/profile/avatar.
// States: "" (ready), saving (a slow save), error, expired, pending-email, photo-error, offline.
const PICTURE = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72"><rect width="72" height="72" fill="seagreen"/></svg>')}`;

export function ProfileDemo({ state }: { state: string }) {
  const action: ProfileAction = async (_previous, form) => {
    if (state === "saving") await new Promise(resolve => setTimeout(resolve, 2500));
    else await new Promise(resolve => setTimeout(resolve, 150));
    if (state === "expired") return { ok: false, error: "session-expired", values: {} };
    if (state === "error") return { ok: false, error: "unavailable" };
    const parsed = parseProfile(readProfileForm(form));
    if (!parsed.ok) return { ok: false, error: "invalid", fields: parsed.fields };
    return { ok: true, name: [parsed.data.firstName, parsed.data.lastName].filter(Boolean).join(" "), phone: String(form.get("phone")) };
  };
  const upload: AvatarUpload = async () => state === "photo-error"
    ? { ok: false, message: "Photos must be a JPG, PNG or HEIC picture." }
    : { ok: true, url: PICTURE };
  return <ProfileSettings initial={{ name: "Sarah Thompson", phone: "021 555 0192" }} email="sarah@example.test"
    pendingEmail={state === "pending-email" ? "sarah.new@example.test" : undefined}
    action={action} upload={upload} preview={state === "offline" ? "offline" : undefined} />;
}
