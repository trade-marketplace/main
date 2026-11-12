"use client";
import { CustomerJob } from "@/components/jobs/CustomerJob";
import type { CustomerExtra } from "@/lib/customer-extras";
import type { CustomerJobView } from "@/server/views";
import type { ExtraWorkActions } from "@/components/jobs/customer/ExtraWorkCard";
import { ExtraWorkCard } from "@/components/jobs/customer/ExtraWorkCard";

const photos = ["board", "modules"].map(name => ({ url: `/images/examples/${name}.jpg` }));
const actions: ExtraWorkActions = {
  approve: async () => ({ ok: true, href: "/dev/components/extra-work?state=checkout" }),
  decline: async () => ({ ok: true }),
  photos: async () => photos,
};
const failing: ExtraWorkActions = { ...actions, approve: async () => ({ ok: false, error: "unavailable" }) };
const changed: ExtraWorkActions = { ...actions, approve: async () => ({ ok: false, error: "changed" }) };

/** The real customer component with fictitious data; preview actions never write to a real job. */
export function ExtraWorkDemo({ job, state }: { job: CustomerJobView; state: string }) {
  const extra: CustomerExtra = { id: "00000000-0000-4000-8000-000000001059", revision: 1,
    status: state === "waiting-office" ? "REQUESTED" : state === "approved" ? "APPROVED" : state === "declined" ? "DECLINED" : "PRICED",
    description: "The switchboard’s second circuit is overloaded and needs a new breaker. It’s not safe to leave.", priceCents: state === "waiting-office" ? null : 14800,
    photoCount: 2, pricedAt: "2026-11-12T00:00:00.000Z", decidedAt: null };
  if (state === "checkout") return <section data-mode="customer"><h1>Extra work checkout</h1><p>+ $148.00</p><a href="/dev/components/extra-work?state=priced-card">Back to job</a></section>;
  if (state === "gallery") return <section data-mode="customer"><h1>Extra work states</h1>{["approved", "declined", "error", "loading"].map(item => <ExtraWorkCard key={item} extras={[{ ...extra, status: item === "approved" ? "APPROVED" : "DECLINED" }]} name="Jack" online preview={item} actions={actions} />)}</section>;
  return <CustomerJob job={job} preview={state === "offline" ? "offline" : "static"} extraPreview={state} extras={state === "empty" ? [] : [extra]} extraActions={state === "pay-error" ? failing : state === "changed" ? changed : actions}
    photos={[{ src: "/images/examples/wires.jpg", alt: "Sub wiring" }]} />;
}
