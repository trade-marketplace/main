import { draftFieldErrors, jobDraftSchema, type JobDraft } from "./job-draft";
import { z } from "zod";
import { LANDING_LOCATION_MAX, type LandingLocation } from "./landing";

export const WIZARD_STEPS = ["What needs doing", "Photos", "Where & when", "Check & post"] as const;
export const JOB_TYPES = [
  { value: "ELECTRICAL", label: "Electrical" }, { value: "PLUMBING", label: "Plumbing" },
  { value: "GAS", label: "Gas fitting" }, { value: "CONSTRUCTION", label: "Construction" },
  { value: "OTHER", label: "Other (anything)" },
] as const;
export type JobType = (typeof JOB_TYPES)[number]["value"];
export type WizardDraft = { data: JobDraft; description: string; manualCategory: boolean; completedDescribe: boolean; locationHint?: LandingLocation };
export const describeJobSchema = jobDraftSchema.pick({ description: true, category: true }).required();
const boundedHintPoint = jobDraftSchema.shape.point.nonoptional();
const locationHintSchema = z.object({ label: z.string().trim().min(1).max(LANDING_LOCATION_MAX).regex(/^[^\u0000-\u001f]*$/), point: boundedHintPoint.nullable() }).strict();

/** An editable place hint, never a structured address or coverage authorization. */
export function landingLocationHint(params: Record<string, string | string[] | undefined>): LandingLocation | undefined {
  if (typeof params.location !== "string") return;
  const label = params.location.replace(/[\u0000-\u001f]/g, "").trim().slice(0, LANDING_LOCATION_MAX);
  if (!label) return;
  const point = typeof params.lat === "string" && params.lat.trim() && typeof params.lng === "string" && params.lng.trim()
    ? boundedHintPoint.safeParse({ lat: Number(params.lat), lng: Number(params.lng) }) : null;
  return { label, point: point?.success ? point.data : null };
}
/** A readable stale envelope wins on restoration; server-only exit must not expose its older input. */
export function localEnvelopeMatchesInput(draft: WizardDraft, stored: WizardDraft | null) {
  if (!stored) return !draft.locationHint;
  return stored.data.postKey === draft.data.postKey && stored.description === draft.description
    && stored.data.category === draft.data.category && stored.manualCategory === draft.manualCategory
    && JSON.stringify(stored.locationHint) === JSON.stringify(draft.locationHint);
}

/** A small editable hint, never a restriction on the category a customer chooses. */
export function guessJobType(description: string): JobType | undefined {
  if (/\b(not sure|moving|clean(?:ing)?|garden(?:ing)?|assembly|assemble)\b/i.test(description)) return "OTHER";
  if (/\b(gas|gasfitter|gasfitting)\b/i.test(description)) return "GAS";
  if (/\b(plumb(?:er|ing)?|tap|leak(?:ing)?|pipe|toilet|drain|shower)\b/i.test(description)) return "PLUMBING";
  if (/\b(electric(?:al|ian)?|light(?:s|ing)?|wir(?:e|es|ing)|switch|socket|power)\b/i.test(description)) return "ELECTRICAL";
  if (/\b(build(?:er|ing)?|carpenter|deck|fence|construction|renovation|wall|roof)\b/i.test(description)) return "CONSTRUCTION";
}

export function initialWizardDraft(data: JobDraft = {}, completedDescribe = false, manualCategory?: boolean | null): WizardDraft {
  return { data: { ...data, category: data.category ?? guessJobType(data.description ?? "") }, description: data.description ?? "", manualCategory: manualCategory ?? Boolean(data.category),
    completedDescribe: completedDescribe && describeJobSchema.safeParse({ description: data.description, category: data.category }).success };
}

export function editDescription(draft: WizardDraft, description: string): WizardDraft {
  const category = draft.manualCategory ? draft.data.category : guessJobType(description);
  return { ...draft, description, data: { ...draft.data, category }, completedDescribe: false };
}

/** A key-bound recovery URL can restore represented server fields without dropping local-only hints. */
export function recoverServerDescribe(local: WizardDraft | null, server: JobDraft, manualCategory?: boolean | null): WizardDraft | null {
  if (!local || !server.postKey || local.data.postKey !== server.postKey) return null;
  const confirmed = initialWizardDraft(server, true, manualCategory);
  return { ...local, description: confirmed.description, manualCategory: confirmed.manualCategory, completedDescribe: confirmed.completedDescribe,
    data: { ...local.data, description: server.description, category: server.category } };
}

/** Later raw steps and local-only location hints cannot be discarded by a Describe recovery. */
export function canClearStaleDescribe(draft: WizardDraft, stored: WizardDraft | null): boolean {
  return Boolean(stored && stored.data.postKey === draft.data.postKey && !stored.locationHint && !draft.locationHint
    && Object.keys(stored.data).every(key => ["postKey", "description", "category", "photoPaths"].includes(key)));
}

/** The canonical draft always uses #116's schema. A separate bounded string keeps unfinished typing too. */
export function canonicalDraft(draft: WizardDraft): JobDraft {
  const rest = { ...draft.data }; delete rest.description;
  const parsed = jobDraftSchema.shape.description.safeParse(draft.description);
  return jobDraftSchema.parse({ ...rest, ...(parsed.success ? { description: parsed.data } : {}) });
}

export function describeErrors(draft: WizardDraft) {
  const parsed = describeJobSchema.safeParse({ description: draft.description, category: draft.data.category });
  return parsed.success ? {} : draftFieldErrors(parsed.error);
}

export function encodeWizardDraft(draft: WizardDraft, ownerId: string | null): string {
  return JSON.stringify({ version: 1, ownerId, data: canonicalDraft(draft), description: draft.description.slice(0, 1000), manualCategory: draft.manualCategory, completedDescribe: draft.completedDescribe, ...(draft.locationHint ? { locationHint: locationHintSchema.parse(draft.locationHint) } : {}) });
}

export function decodeWizardDraft(raw: string | null, ownerId: string | null): WizardDraft | null {
  try {
    const stored = JSON.parse(raw ?? "null");
    if (!stored || stored.version !== 1 || stored.ownerId !== ownerId || typeof stored.description !== "string" || stored.description.length > 1000) return null;
    const hint = stored.locationHint === undefined ? undefined : locationHintSchema.safeParse(stored.locationHint);
    if (hint && !hint.success) return null;
    const data = jobDraftSchema.safeParse(stored.data);
    return data.success ? { data: data.data, description: stored.description, manualCategory: stored.manualCategory === true, completedDescribe: stored.completedDescribe === true, ...(hint?.success ? { locationHint: hint.data } : {}) } : null;
  } catch { return null; }
}

/** Landing-page values are hints. Later steps still validate the complete draft on the server. */
export function landingWizardDraft(params: Record<string, string | string[] | undefined>): JobDraft {
  const description = typeof params.description === "string" ? params.description.slice(0, 120) : "";
  const type = typeof params.type === "string" ? params.type.toUpperCase() : "";
  // Presence means an explicit landing choice. The initializer infers free text without marking it manual.
  const category = JOB_TYPES.find((item) => item.value === type)?.value;
  return { ...(description ? { description } : {}), ...(category ? { category } : {}) };
}

/** A new home handoff edits Describe once, preserving the existing draft's key and later-step fields. */
export function applyLandingHandoff(draft: WizardDraft, handoff: JobDraft): WizardDraft {
  let next = draft;
  if (handoff.description !== undefined) next = editDescription({ ...draft, manualCategory: Boolean(handoff.category), data: { ...draft.data, category: handoff.category } }, handoff.description);
  if (handoff.category) next = { ...next, data: { ...next.data, category: handoff.category }, manualCategory: true, completedDescribe: false };
  return next;
}
