import type { Metadata } from "next";
import { OfficeShellView } from "@/components/office/OfficeShellView";
import { SETTINGS_TABS, type SettingsTab } from "@/lib/office-settings";
import { guardDevPage } from "@/server/dev-pages";
import { OfficeSettingsDemo } from "./OfficeSettingsDemo";
import { officeSettingsPreview } from "./preview-data";

export const metadata: Metadata = { title: "Office settings (dev)", robots: { index: false, follow: false } };
export default async function OfficeSettingsPreview({ searchParams }: { searchParams: Promise<{ tab?: string; state?: string }> }) {
  guardDevPage();
  const query = await searchParams;
  const tab = SETTINGS_TABS.includes(query.tab as SettingsTab) ? query.tab as SettingsTab : "rates";
  const states = ["default", "loading", "saving", "saved", "validation", "save-error", "no-changes", "offline"];
  const state = states.includes(query.state ?? "") ? query.state! : "default";
  return <OfficeShellView viewer={{ role: "ADMIN", firstName: "Matt", lastName: "Larsen", email: "office@demo.test" }} testMode><OfficeSettingsDemo data={officeSettingsPreview()} tab={tab} state={state} /></OfficeShellView>;
}
