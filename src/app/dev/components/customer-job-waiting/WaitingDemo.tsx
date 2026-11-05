"use client";
import { useState } from "react";
import { CustomerJob } from "@/components/jobs/CustomerJob";
import { CUSTOMER_PRICE_DELAY_MS } from "@/lib/customer-job-waiting";
import type { CustomerJobView } from "@/server/views";

/** The guarded preview uses the production frame/actions with an in-memory save, never a real customer write. */
export function WaitingDemo({ initial, state }: { initial: CustomerJobView; state: string }) {
  const [job, setJob] = useState(initial);
  return <CustomerJob job={job} photos={state === "empty" ? [] : ["wires", "switch", "board"].map((name, index) => ({ src: `/images/examples/${name}.jpg`, alt: `${job.title} · ${index + 1}` }))}
    back="/dashboard?q=Sub+wiring" preview={state === "offline" ? "offline" : "static"} initialAgeMs={state === "delayed" ? CUSTOMER_PRICE_DELAY_MS + 1 : 0}
    waitingPreview={state} waitingActions={{
      save: async (_id, _revision, value) => { if (state === "error") return { status: "unavailable" }; setJob({ ...job, ...value, address: { ...job.address, accessNotes: value.accessNotes || null } }); return { status: "saved" }; },
      cancel: async () => { if (state === "cancel-error") return { status: "unavailable" }; setJob({ ...job, status: "CANCELLED" }); return { status: "cancelled" }; },
    }} />;
}
