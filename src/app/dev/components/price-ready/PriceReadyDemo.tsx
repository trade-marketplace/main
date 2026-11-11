"use client";
import { useState } from "react";
import { CustomerJob } from "@/components/jobs/CustomerJob";
import { paymentFailure } from "@/lib/payments/results";
import type { CustomerJobView } from "@/server/views";

/** Fictitious previews use the real panel; no preview interaction writes customer data. */
export function PriceReadyDemo({ initial, state }: { initial: CustomerJobView; state: string }) {
  const [job, setJob] = useState(initial);
  return <CustomerJob job={job} photos={state === "empty" ? [] : ["wires", "switch", "board"].map((name, index) => ({ src: `/images/examples/${name}.jpg`, alt: `${job.title} · ${index + 1}` }))}
    preview={state === "offline" ? "offline" : "static"} pricePreview={state} previousPriceCents={state === "repriced" ? 42000 : null} priceActions={{
      pay: async () => paymentFailure("not-configured"),
      decline: async () => { if (state === "decline-error") return { status: "unavailable" }; setJob({ ...job, status: "CANCELLED" }); return { status: "declined" }; },
    }} />;
}
