"use client";
import { PostJobWizard } from "@/components/jobs/PostJobWizard";
import type { JobDraft } from "@/lib/job-draft";
export function PostJobDemo({ state }: { state: string }) {
  const initialDraft: JobDraft = state === "empty" || state === "invalid" ? {} : {
    description: state === "other" ? "Moving some furniture and assembling a garden bench." : "Lights in the lounge keep flickering and the switch is getting warm. Pretty sure some wires behind it are exposed.",
    ...(state === "other" ? { category: "OTHER" as const } : state === "photos" ? { category: "ELECTRICAL" as const, postKey: "8608ab1f-2862-4c44-9490-88f5e17375bd" } : {}),
  };
  return <PostJobWizard previewState={state} initialDraft={initialDraft} loadFailed={state === "load-error"} save={async () => ({ status: "saved" })} />;
}
