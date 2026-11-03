import { draftFieldErrors, jobDraftSchema, type JobDraft } from "./job-draft";

export const WIZARD_STEPS = ["What needs doing", "Photos", "Where & when", "Check & post"] as const;
export const JOB_TYPES = [
  { value: "ELECTRICAL", label: "Electrical" }, { value: "PLUMBING", label: "Plumbing" },
  { value: "GAS", label: "Gas fitting" }, { value: "CONSTRUCTION", label: "Construction" },
  { value: "OTHER", label: "Other (anything)" },
] as const;
export type JobType = (typeof JOB_TYPES)[number]["value"];
export type WizardDraft = { data: JobDraft; description: string; manualCategory: boolean; completedDescribe: boolean; completedPhotos: boolean };
export const describeJobSchema = jobDraftSchema.pick({ description: true, category: true }).required();

/** A small editable hint, never a restriction on the category a customer chooses. */
export function guessJobType(description: string): JobType | undefined {
  if (/\b(not sure|moving|clean(?:ing)?|garden(?:ing)?|assembly|assemble)\b/i.test(description)) return "OTHER";
  if (/\b(gas|gasfitter|gasfitting)\b/i.test(description)) return "GAS";
  if (/\b(plumb(?:er|ing)?|tap|leak(?:ing)?|pipe|toilet|drain|shower)\b/i.test(description)) return "PLUMBING";
  if (/\b(electric(?:al|ian)?|light(?:s|ing)?|wir(?:e|es|ing)|switch|socket|power)\b/i.test(description)) return "ELECTRICAL";
  if (/\b(build(?:er|ing)?|carpenter|deck|fence|construction|renovation|wall|roof)\b/i.test(description)) return "CONSTRUCTION";
}

export function initialWizardDraft(data: JobDraft = {}, completedDescribe = false): WizardDraft {
  return { data: { ...data, category: data.category ?? guessJobType(data.description ?? "") }, description: data.description ?? "", manualCategory: Boolean(data.category),
    completedDescribe: completedDescribe && describeJobSchema.safeParse({ description: data.description, category: data.category }).success, completedPhotos: false };
}

export function editDescription(draft: WizardDraft, description: string): WizardDraft {
  const category = draft.manualCategory ? draft.data.category : guessJobType(description);
  return { ...draft, description, data: { ...draft.data, category }, completedDescribe: false };
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
  return JSON.stringify({ version: 1, ownerId, data: canonicalDraft(draft), description: draft.description.slice(0, 1000), manualCategory: draft.manualCategory, completedDescribe: draft.completedDescribe, completedPhotos: draft.completedPhotos });
}

export function decodeWizardDraft(raw: string | null, ownerId: string | null): WizardDraft | null {
  try {
    const stored = JSON.parse(raw ?? "null");
    if (!stored || stored.version !== 1 || stored.ownerId !== ownerId || typeof stored.description !== "string" || stored.description.length > 1000) return null;
    const data = jobDraftSchema.safeParse(stored.data);
    return data.success ? { data: data.data, description: stored.description, manualCategory: stored.manualCategory === true, completedDescribe: stored.completedDescribe === true, completedPhotos: stored.completedPhotos === true } : null;
  } catch { return null; }
}

/** Local text may be unfinished; authenticated uploaded-photo references/order come from the current draft. */
export function reconcileWizardPhotos(local: WizardDraft | null, server: JobDraft, authoritative: boolean): WizardDraft | null {
  if (!local || !authoritative) return local;
  if (!server.postKey || local.data.postKey !== server.postKey) return null;
  return { ...local, data: { ...local.data, photoPaths: server.photoPaths ?? [] } };
}

/** Landing-page values are hints. Later steps still validate the complete draft on the server. */
export function landingWizardDraft(params: Record<string, string | string[] | undefined>): JobDraft {
  const description = typeof params.description === "string" ? params.description.slice(0, 120) : "";
  const type = typeof params.type === "string" ? params.type.toUpperCase() : "";
  // Presence means an explicit landing choice. The initializer infers free text without marking it manual.
  const category = JOB_TYPES.find((item) => item.value === type)?.value;
  return { ...(description ? { description } : {}), ...(category ? { category } : {}) };
}
