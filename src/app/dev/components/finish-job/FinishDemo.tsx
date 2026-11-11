"use client";
import { useState } from "react";
import { FinishJob, FinishLoading, FinishLoadError } from "@/components/jobs/worker/FinishJob";
import type { FinishResult, FinishState, FinishUploadResult, FinishView } from "@/lib/finish-job";
export const finishExample: FinishView = {
  id: "15000000-0000-4000-8000-000000000001", ownerId: "15000000-0000-4000-8000-000000000002", title: "Sub wiring", customerFirstName: "Sarah", category: "ELECTRICAL", autoReleaseHours: 48,
  rule: { cocRequired: true, cocFileRequired: true, minPhotos: 2, notesRequired: false }, fields: { cocNumber: "2026-118734", notes: "Replaced the outdoor plug and checked the circuit.", spent: "72.50", declaration: true, reason: "" },
  photos: [{ id: "15000000-0000-4000-8000-000000000010", src: "/images/examples/board.jpg", name: "Finished switchboard" }, { id: "15000000-0000-4000-8000-000000000011", src: "/images/examples/wires.jpg", name: "Finished wiring" }],
  cocDocument: { url: "/images/examples/board.jpg", name: "CoC-TM1005.pdf", size: 412 * 1024 }, receipt: null, budgetCents: 8500, extraWorkOpen: false, readOnly: false,
};
export function FinishDemo({ state, embedded = false }: { state: FinishState; embedded?: boolean }) {
  const [recovered, setRecovered] = useState(false);
  if (state === "loading") return <FinishLoading embedded={embedded} />;
  if (state === "load-error" && !recovered) return <FinishLoadError embedded={embedded} retry={() => setRecovered(true)} />;
  const other = state === "other-trade" || state === "over-budget";
  const job: FinishView = { ...finishExample, fields: { ...finishExample.fields }, ...(other ? { category: "PLUMBING", rule: { cocRequired: false, cocFileRequired: false, minPhotos: 1, notesRequired: true }, cocDocument: null, receipt: { url: "/images/examples/board.jpg", name: "Materials receipt.jpg", size: 52 * 1024 } } : {}),
    budgetCents: state === "no-budget" ? 0 : 8500, rule: state === "not-configured" ? null : other ? { cocRequired: false, cocFileRequired: false, minPhotos: 1, notesRequired: true } : finishExample.rule,
    extraWorkOpen: state === "waiting-extra", readOnly: state === "read-only" };
  if (state === "over-budget") job.fields = { ...job.fields, spent: "95.00", reason: "The damaged cable needed replacing." };
  if (state === "field-errors") { job.fields = { cocNumber: "", notes: "", spent: "invalid", declaration: false, reason: "" }; job.photos = []; job.cocDocument = null; }
  async function upload(_id: string, _kind: string, file: File, requestId: string): Promise<FinishUploadResult> { return { status: "uploaded", file: { id: requestId, url: "/images/examples/board.jpg", name: file.name, size: file.size } }; }
  async function save(): Promise<FinishResult> { return { status: "saved" }; }
  async function send(): Promise<FinishResult> { return { status: "sent" }; }
  return <FinishJob job={job} preview={state} embedded={embedded} upload={upload} save={save} send={send} remove={save} />;
}
