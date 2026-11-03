"use server";

import { revalidatePath } from "next/cache";
import { withRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { consumeForUser } from "@/server/rate-limit";
import type { SettingsResult } from "@/lib/office-settings";
import { countCoverageWaitlist, previewSettings, readOfficeSettings, requireSettingsAdmin, saveOfficeSettings } from "./settings";
import { OfficeUserError, officeUsers } from "./users";

export const saveOfficeSettingsAction = withRole(["ADMIN"], async (viewer, input: unknown): Promise<SettingsResult> => {
  try {
    const result = await saveOfficeSettings(getDb(), viewer, input);
    if (result.ok) revalidatePath("/admin/settings");
    return result;
  } catch { return { ok: false, error: "unavailable" }; }
});
export const previewOfficeSettingsAction = withRole(["ADMIN"], async (viewer, input: unknown) => {
  try {
    const data = await readOfficeSettings(getDb(), viewer);
    return previewSettings(input, data.record);
  } catch { return { ok: false as const }; }
});
export const previewCoverageAction = withRole(["ADMIN"], async (viewer, input: unknown) => {
  const rate = await consumeForUser("placeSearch", viewer.userId);
  if (!rate.allowed) return { ok: false as const };
  try { return { ok: true as const, count: await countCoverageWaitlist(getDb(), viewer, input) }; }
  catch { return { ok: false as const }; }
});
export const manageOfficeTeamAction = withRole(["ADMIN"], async (viewer, input: { operation: "preview-add" | "add" | "remove"; email: string }) => {
  try {
    if (!["preview-add", "add", "remove"].includes(input.operation) || typeof input.email !== "string") return { ok: false as const, error: "Check the email address." };
    const db = getDb();
    await requireSettingsAdmin(db, viewer);
    const users = officeUsers(db, undefined, viewer);
    if (input.operation === "preview-add") {
      const person = await users.find(input.email);
      return { ok: true as const, before: person.role, email: person.email };
    }
    const person = await users[input.operation](input.email);
    revalidatePath("/admin/settings");
    if (input.operation === "remove" && person.id === viewer.userId) return { ok: true as const, leaveOffice: true };
    const team = (await users.list()).map(user => ({ email: user.email, since: user.since?.toISOString() ?? null }));
    return { ok: true as const, team };
  } catch (error) { return { ok: false as const, error: error instanceof OfficeUserError ? error.message : "Couldn’t save that. Nothing was changed. Try again." }; }
});
