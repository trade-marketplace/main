import { HowItWorks } from "@/components/site/HowItWorks";
import { SiteShellView } from "@/components/site/SiteShell";
import { MaintenanceBanner } from "@/app/maintenance/banner";
import { MaintenancePage } from "@/app/maintenance/view";
import { maintenanceWindow } from "@/lib/maintenance";
import { guardDevPage } from "@/server/dev-pages";

export default async function Page({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  guardDevPage();
  const window = maintenanceWindow("2025-11-07T23:00:00+13:00", "2025-11-08T06:00:00+13:00")!;
  return (await searchParams).state === "banner"
    ? <><MaintenanceBanner label={window.label} /><SiteShellView viewer={null}><HowItWorks /></SiteShellView></>
    : <MaintenancePage window={window} />;
}
