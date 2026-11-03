import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";
import { OfficeSettings } from "@/components/office/OfficeSettings";
import { SETTINGS_TABS, type SettingsTab } from "@/lib/office-settings";
import { requireRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { publicMapboxToken } from "@/server/geo/mapbox-config";
import { readOfficeSettings } from "@/server/office/settings";

export const metadata: Metadata = { title: "Settings" };
export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const viewer = await requireRole(["ADMIN"], { next: "/admin/settings" });
  const query = await searchParams;
  const initialTab: SettingsTab = SETTINGS_TABS.includes(query.tab as SettingsTab) ? query.tab as SettingsTab : "rates";
  let data = null;
  try { data = await readOfficeSettings(getDb(), viewer); }
  catch (error) { unstable_rethrow(error); console.error("Office settings are unavailable."); }
  return <OfficeSettings data={data} initialTab={initialTab} mapToken={publicMapboxToken()} />;
}
