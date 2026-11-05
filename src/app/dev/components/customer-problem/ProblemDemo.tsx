"use client";
import { CustomerProblem, CustomerProblemLoadError } from "@/components/jobs/CustomerProblem";
import type { CustomerProblemState } from "@/lib/customer-problem";

const id = "18200000-0000-4000-8000-000000000001";
export function ProblemDemo({ state, embedded = false }: { state: CustomerProblemState | "load-error" | "completed-sent"; embedded?: boolean }) {
  const backHref = "/dev/components/customer-job?state=submitted";
  if (state === "load-error") return <CustomerProblemLoadError backHref={backHref} embedded={embedded} />;
  return <CustomerProblem job={{ id, jobNumber: 1005, title: "Replace a broken light switch" }} state={state === "completed-sent" ? "sent" : state} preview embedded={embedded} backHref={backHref}
    initialReport={["sent", "completed-sent"].includes(state) ? { id, topic: "Work not finished", details: "The light switch is still loose. I’ve added a photo of the problem.", urgent: false, photoCount: 1, releasePaused: state !== "completed-sent" } : null}
    upload={async (_jobId, file) => { if (file.name.includes("fail")) throw new Error("upload-failed"); return `preview/${file.name}`; }}
    save={async input => state === "error" ? { ok: false, error: "unavailable" } : { ok: true, report: { id, topic: input.topic, details: input.details, urgent: input.urgent, photoCount: input.photoPaths.length, releasePaused: true } }} />;
}
