"use client";
import { useState } from "react";
import { Workspace, WorkspaceLoading, WorkspaceLoadError } from "@/components/jobs/worker/Workspace";
import type { JobUpdateResult, WorkspaceState, WorkspaceView } from "@/lib/worker-workspace";
export const workspaceExample: WorkspaceView = {
  id: "14900000-0000-4000-8000-000000000001", jobNumber: 1005, title: "Sub wiring", description: "Replace the outdoor double plug.", category: "ELECTRICAL", status: "ASSIGNED",
  earnCents: 25920, customer: { firstName: "Sarah", lastInitial: "T", phone: "0215550192" }, address: "12 Campbell Street, Windsor, Invercargill, 9810", accessNotes: "Use the side gate.",
  bookedDate: "2026-11-12", bookedTime: "MORNING", budgetCents: 8500, extraWorkOpen: false, claimedAt: new Date().toISOString(),
  signOffDeadline: null, autoReleaseHours: 48, payout: null,
};
export function WorkspaceDemo({ state, embedded = false }: { state: WorkspaceState; embedded?: boolean }) {
  const [deadline] = useState(() => new Date(Date.now() + 46 * 3_600_000).toISOString());
  const [recovered, setRecovered] = useState(false), [attempts, setAttempts] = useState(0);
  if (state === "loading") return <WorkspaceLoading embedded={embedded} />;
  if (state === "load-error" && !recovered) return <WorkspaceLoadError embedded={embedded} retry={() => setRecovered(true)} />;
  const job = { ...workspaceExample, ...(state === "not-booked" ? { bookedDate: null, bookedTime: null } : {}), ...(state === "other-trade" ? { category: "PLUMBING" as const } : {}),
    extraWorkOpen: state === "waiting-extra", status: state === "submitted" ? "SUBMITTED" as const : state === "completed" ? "COMPLETED" as const : state === "on-hold" ? "CANCEL_REVIEW" as const : "ASSIGNED" as const,
    signOffDeadline: state === "submitted" ? deadline : null };
  async function send(): Promise<JobUpdateResult> { setAttempts(attempts + 1); return state === "try-later" && attempts === 0 ? { status: "try-later", retryAfter: 300 } : { status: "sent" }; }
  return <Workspace job={job} preview={state} embedded={embedded} send={send} />;
}
