import { draftFieldErrors, jobDraftSchema, postJobSchema, type JobDraft } from "./job-draft";
import { timeWindowsInRange } from "./job-time-windows";

export const WIZARD_STEPS = ["What needs doing", "Photos", "Where & when", "Check & post"] as const;
export const JOB_TYPES = [
  { value: "ELECTRICAL", label: "Electrical" }, { value: "PLUMBING", label: "Plumbing" },
  { value: "GAS", label: "Gas fitting" }, { value: "CONSTRUCTION", label: "Construction" },
  { value: "OTHER", label: "Other (anything)" },
] as const;
export type JobType = (typeof JOB_TYPES)[number]["value"];
export const WHERE_TEXT_LIMITS = { addressLine1: 200, addressLine2: 200, suburb: 100, city: 100, postcode: 4, accessNotes: 1000 } as const;
export type WhereInputs = { [Key in keyof typeof WHERE_TEXT_LIMITS]: string };
export type WizardDraft = { data: JobDraft; description: string; manualCategory: boolean; completedDescribe: boolean; completedPhotos: boolean; completedWhere: boolean; where?: WhereInputs };
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
  const draft: WizardDraft = { data: { ...data, category: data.category ?? guessJobType(data.description ?? "") }, description: data.description ?? "", manualCategory: Boolean(data.category),
    completedDescribe: completedDescribe && describeJobSchema.safeParse({ description: data.description, category: data.category }).success,
    completedPhotos: completedDescribe && Boolean(data.addressLine1 || data.timeWindows?.length || data.anyTime), completedWhere: false };
  draft.completedWhere = completedDescribe && !Object.keys(whereErrors(draft, new Date())).length;
  return draft;
}

export function editDescription(draft: WizardDraft, description: string): WizardDraft {
  const category = draft.manualCategory ? draft.data.category : guessJobType(description);
  return { ...draft, description, data: { ...draft.data, category }, completedDescribe: false };
}

/** The canonical draft always uses #116's schema. A separate bounded string keeps unfinished typing too. */
export function canonicalDraft(draft: WizardDraft): JobDraft {
  const rest = { ...draft.data }; delete rest.description;
  if (draft.where) for (const key of Object.keys(WHERE_TEXT_LIMITS) as (keyof WhereInputs)[]) {
    const raw = key === "postcode" && !draft.where[key].trim() ? undefined : draft.where[key];
    const value = jobDraftSchema.shape[key].safeParse(raw);
    if (value.success && value.data !== undefined) rest[key] = value.data;
    else delete rest[key];
  }
  const parsed = jobDraftSchema.shape.description.safeParse(draft.description);
  return jobDraftSchema.parse({ ...rest, ...(parsed.success ? { description: parsed.data } : {}) });
}

export function whereInputs(draft: WizardDraft): WhereInputs {
  return draft.where ?? Object.fromEntries(Object.keys(WHERE_TEXT_LIMITS).map(key => [key, draft.data[key as keyof WhereInputs] ?? ""])) as WhereInputs;
}

/** Keep incomplete address typing locally, while canonical fields continue to use #116's shared schema. */
export function editWhere(draft: WizardDraft, patch: Partial<WhereInputs>, location?: Pick<JobDraft, "locationSource" | "point">): WizardDraft {
  const next = { ...draft, where: { ...whereInputs(draft), ...patch }, data: { ...draft.data, ...location }, completedWhere: false };
  return { ...next, data: canonicalDraft(next) };
}

export function whereErrors(draft: WizardDraft, now: Date): Record<string, string> {
  const input = { ...canonicalDraft(draft), photoPaths: draft.data.photoPaths ?? [], anyTime: draft.data.anyTime ?? false, asap: draft.data.asap ?? false, timeWindows: draft.data.timeWindows ?? [] };
  const parsed = postJobSchema.safeParse(input);
  const all = parsed.success ? {} : draftFieldErrors(parsed.error);
  const fields = Object.fromEntries(Object.entries(all).filter(([key]) => ["addressLine1", "addressLine2", "suburb", "city", "postcode", "point", "locationSource", "accessNotes", "timeWindows"].includes(key)));
  if (!timeWindowsInRange(input.timeWindows, now)) fields.timeWindows = "When do you need it?";
  // A partial postcode must be retained locally and still shown as invalid on Next.
  if (draft.where?.postcode.trim() && !jobDraftSchema.shape.postcode.safeParse(draft.where.postcode).success) fields.postcode = "Address";
  return fields;
}

export function describeErrors(draft: WizardDraft) {
  const parsed = describeJobSchema.safeParse({ description: draft.description, category: draft.data.category });
  return parsed.success ? {} : draftFieldErrors(parsed.error);
}

export function encodeWizardDraft(draft: WizardDraft, ownerId: string | null): string {
  return JSON.stringify({ version: 1, ownerId, data: canonicalDraft(draft), description: draft.description.slice(0, 1000), manualCategory: draft.manualCategory, completedDescribe: draft.completedDescribe, completedPhotos: draft.completedPhotos, completedWhere: draft.completedWhere, ...(draft.where ? { where: draft.where } : {}) });
}

export function decodeWizardDraft(raw: string | null, ownerId: string | null): WizardDraft | null {
  try {
    const stored = JSON.parse(raw ?? "null");
    if (!stored || stored.version !== 1 || stored.ownerId !== ownerId || typeof stored.description !== "string" || stored.description.length > 1000) return null;
    if (stored.where !== undefined && (!stored.where || typeof stored.where !== "object" || Array.isArray(stored.where)
      || Object.keys(stored.where).some(key => !Object.hasOwn(WHERE_TEXT_LIMITS, key))
      || Object.entries(WHERE_TEXT_LIMITS).some(([key, max]) => typeof stored.where[key] !== "string" || stored.where[key].length > max))) return null;
    const data = jobDraftSchema.safeParse(stored.data);
    return data.success ? { data: data.data, description: stored.description, manualCategory: stored.manualCategory === true, completedDescribe: stored.completedDescribe === true, completedPhotos: stored.completedPhotos === true, completedWhere: stored.completedWhere === true, ...(stored.where ? { where: stored.where as WhereInputs } : {}) } : null;
  } catch { return null; }
}

/** Landing-page values are hints. Later steps still validate the complete draft on the server. */
export function landingWizardDraft(params: Record<string, string | string[] | undefined>): JobDraft {
  const description = typeof params.description === "string" ? params.description.slice(0, 120) : "";
  const type = typeof params.type === "string" ? params.type.toUpperCase() : "";
  const category = JOB_TYPES.find((item) => item.value === type)?.value ?? guessJobType(description);
  return { ...(description ? { description } : {}), ...(category ? { category } : {}) };
}
