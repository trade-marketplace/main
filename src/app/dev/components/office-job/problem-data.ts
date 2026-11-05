import type { OfficeProblemReportState, OfficeProblemReportView } from "@/lib/office-problem";
export function previewProblemReport(problem: string | undefined): OfficeProblemReportState | null {
  const sample: OfficeProblemReportView = { id: "18200000-0000-4000-8000-000000000001", topic: "Work not finished", details: "The light switch is still loose. I’ve added a photo of the problem.", urgent: true, status: problem === "resolved" ? "RESOLVED" : "OPEN", createdAt: "2026-11-04T22:00:00Z", when: "5m ago", photos: problem === "empty" ? [] : [{ id: "report-photo", url: problem === "photo-error" ? null : "/images/examples/switch.jpg" }] };
  return problem === "loading" || problem === "error" ? { state: problem } : problem ? { state: problem === "offline" ? "offline" : "ready", report: sample } : null;
}
