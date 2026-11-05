import type { Metadata } from "next";
import { AppShellView } from "@/components/app/AppShellView";
import { CustomerHome } from "@/components/home/CustomerHome";
import { CATEGORIES } from "@/lib/cards";
import type { CustomerHomeData, HomeJob } from "@/lib/customer-home";
import { INVERCARGILL_COVERAGE } from "@/lib/geo/coverage";
import { guardDevPage } from "@/server/dev-pages";

export const metadata: Metadata = { title: "Customer home (dev)", robots: { index: false, follow: false } };
function job(index: number, status: HomeJob["status"], title: string, action: HomeJob["action"] = null): HomeJob {
  return { id: `11500000-0000-4000-8000-${String(index).padStart(12, "0")}`, jobNumber: 1000 + index, title, category: "ELECTRICAL", status,
    suburb: "Windsor", city: "Invercargill", asap: false, createdAt: "2026-11-04T00:00:00Z", updatedAt: "2026-11-04T00:00:00Z", priceCents: status === "PRICED" ? 37200 : null, gstCents: null, action };
}
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  guardDevPage();
  const params = await searchParams, state = typeof params.state === "string" ? params.state : "jobs";
  const empty = state === "empty" || state === "loading";
  const needsYou = empty || state === "no-action" ? [] : state === "extra-work" ? [job(3, "ASSIGNED", "Fix fence palings", "extra-work")] : state === "sign-off" ? [job(2, "SUBMITTED", "Fix fence palings", "sign-off")] : [job(1, "PRICED", "Sub wiring", "price"), job(2, "SUBMITTED", "Fix fence palings", "sign-off")];
  const data: CustomerHomeData = { firstName: state === "long" ? "Alexandria-With-A-Very-Long-Name" : "Sarah", coverage: INVERCARGILL_COVERAGE,
    location: state === "outside" ? { label: "Dunedin", point: { lat: -45.8788, lng: 170.5028 } } : { label: "Windsor, Invercargill", point: { lat: -46.4, lng: 168.36 } }, outside: state === "outside", categories: CATEGORIES,
    needsYou, inProgress: empty ? [] : [job(4, "REVIEW", state === "long" ? "A very long job title that should remain readable without pushing the page sideways at any screen width" : "Kitchen tap leaking")],
    recent: state === "recent" ? [job(5, "COMPLETED", "Hang a door")] : [], counts: { needsYou: needsYou.length, inProgress: empty ? 0 : 1 } };
  return <AppShellView viewer={{ role: "CUSTOMER", firstName: "Sarah", lastName: "Thompson", email: "customer@example.test", emailVerified: true, counts: { messages: 0, notifications: 0 } }} testMode preview={{ at: "/", base: "/dev/components/customer-home" }}><CustomerHome result={state === "error" ? { ok: false } : { ok: true, data }} loading={state === "loading"} previewOffline={state === "offline"} /></AppShellView>;
}
