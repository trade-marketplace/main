"use client";
import { useRef } from "react";
import { Workspace, WorkspaceLoading } from "@/components/jobs/worker/Workspace";
import type { ExtraWorkServices } from "@/components/jobs/worker/ExtraWorkDrawer";
import type { ExtraWorkState, WorkerExtra } from "@/lib/worker-extras";
import type { WorkspaceView } from "@/lib/worker-workspace";
const job: WorkspaceView = {
  id: "16000000-0000-4000-8000-000000000010", jobNumber: 1005, title: "Sub wiring", description: "Replace the outdoor double plug.", category: "ELECTRICAL", status: "ASSIGNED",
  earnCents: 25920, customer: { firstName: "Sarah", lastInitial: "T", phone: "0215550192" }, address: "12 Campbell Street, Windsor, Invercargill, 9810", accessNotes: "Use the side gate.",
  bookedDate: "2026-11-12", bookedTime: "MORNING", budgetCents: 8500, extraWorkOpen: false, claimedAt: null, signOffDeadline: null, autoReleaseHours: 48, payout: null,
};
export function ExtraWorkDemo({ state, embedded = false }: { state: ExtraWorkState; embedded?: boolean }) {
  const attempts = useRef(0), key = useRef<string | null>(null);
  if (state === "loading") return <WorkspaceLoading embedded={embedded} />;
  const status = state === "priced" ? "PRICED" : state === "approved" ? "APPROVED" : state === "declined" ? "DECLINED" : "REQUESTED";
  const extras: WorkerExtra[] = ["sent", "priced", "approved", "declined", "already-waiting"].includes(state) ? [{ id: "16000000-0000-4000-8000-000000000020", status, description: "Replace the second cracked switch.", requestedMinutes: 30, minutes: status === "REQUESTED" ? null : 30, workerEarnsCents: status === "REQUESTED" ? null : 6400, photoCount: 1, createdAt: "2026-11-12T03:00:00Z" }] : [];
  const services: ExtraWorkServices = {
    async upload(_job, _key, _file, progress) { progress(.5); return `preview-${crypto.randomUUID()}`; },
    async request(input) {
      if (key.current && key.current !== input.requestKey) throw Error("Retry changed the request key"); key.current = input.requestKey;
      attempts.current++;
      if (state === "error" && attempts.current === 1) throw Error("Lost response");
      if (state === "try-later" && attempts.current === 1) return { ok: false, error: "photos-pending" };
      return { ok: true, variationId: "16000000-0000-4000-8000-000000000021" };
    },
  };
  return <Workspace job={job} extras={extras} extraPreview={state} extraServices={services} embedded={embedded} send={async () => ({ status: "sent" })} myWorkHref="/dev/components/my-work" />;
}
