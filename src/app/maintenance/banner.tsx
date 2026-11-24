import { Banner } from "@/components/overlays/Banner";

export function MaintenanceBanner({ label }: { label: string }) {
  return <aside aria-label="Scheduled maintenance">
    <Banner tone="info">Upgrades on {label}. Your jobs are safe.</Banner>
  </aside>;
}
