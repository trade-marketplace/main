"use client";
import { useEffect, useRef, useState } from "react";
import { CustomerJob } from "@/components/jobs/CustomerJob";
import type { CustomerSignoff } from "@/lib/customer-signoff";
import type { CustomerJobView } from "@/server/views";

export function SignoffDemo({ job, data, state }: { job: CustomerJobView; data: CustomerSignoff | null; state: string }) {
  const [completed, setCompleted] = useState(false), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return <CustomerJob job={completed ? { ...job, status: "COMPLETED" } : job} signoffData={data} signoffPreview={state} back="/dashboard?q=Sub+wiring" preview={state === "offline" ? "offline" : "static"}
    photos={state === "empty" ? [] : ["wires", "switch", "board"].map((name, index) => ({ src: `/images/examples/${name}.jpg`, alt: `${job.title} · ${index + 1}` }))}
    signoffAction={async () => { await new Promise(resolve => setTimeout(resolve, 160)); timer.current = setTimeout(() => setCompleted(true), 650); return { status: "signed-off" }; }} />;
}
