import { draftFieldErrors, jobDraftSchema, postJobSchema, type JobDraft } from "./job-draft";
import { currentSchedule, timeWindowsInRange } from "./job-time-windows";
import { z } from "zod";
import { LANDING_LOCATION_MAX, type LandingLocation } from "./landing";

export const WIZARD_STEPS = ["What needs doing", "Photos", "Where & when", "Check & post"] as const;
export const JOB_TYPES = [
  { value: "ELECTRICAL", label: "Electrical" }, { value: "PLUMBING", label: "Plumbing" },
  { value: "GAS", label: "Gas fitting" }, { value: "CONSTRUCTION", label: "Construction" },
  { value: "OTHER", label: "Other (anything)" },
] as const;
export type JobType = (typeof JOB_TYPES)[number]["value"];
export const WHERE_TEXT_LIMITS = { addressLine1: 200, addressLine2: 200, suburb: 100, city: 100, postcode: 4, accessNotes: 1000 } as const;
export type WhereInputs = { [Key in keyof typeof WHERE_TEXT_LIMITS]: string };
const WHERE_SNAPSHOT_FIELDS: readonly (keyof JobDraft)[] = [...Object.keys(WHERE_TEXT_LIMITS) as (keyof WhereInputs)[], "locationSource", "point", "asap", "anyTime", "timeWindows"];
export type WizardDraft = { data: JobDraft; description: string; manualCategory: boolean; completedDescribe: boolean; completedPhotos: boolean; completedWhere: boolean; where?: WhereInputs; locationHint?: LandingLocation };
export const describeJobSchema = jobDraftSchema.pick({ description: true, category: true }).required();
const boundedHintPoint = jobDraftSchema.shape.point.nonoptional();
export const locationHintSchema = z.object({ label: z.string().trim().min(1).max(LANDING_LOCATION_MAX).regex(/^[^\u0000-\u001f]*$/), point: boundedHintPoint.nullable() }).strict();

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
    && JSON.stringify(stored.locationHint) === JSON.stringify(draft.locationHint)
    && JSON.stringify(whereInputs(stored)) === JSON.stringify(whereInputs(draft))
    && stored.data.locationSource === draft.data.locationSource
    && JSON.stringify(stored.data.point) === JSON.stringify(draft.data.point)
    && (stored.data.asap ?? false) === (draft.data.asap ?? false)
    && (stored.data.anyTime ?? false) === (draft.data.anyTime ?? false)
    && JSON.stringify(stored.data.timeWindows ?? []) === JSON.stringify(draft.data.timeWindows ?? []);
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
  const draft: WizardDraft = { data: { ...data, category: data.category ?? guessJobType(data.description ?? "") }, description: data.description ?? "", manualCategory: manualCategory ?? Boolean(data.category),
    completedDescribe: completedDescribe && describeJobSchema.safeParse({ description: data.description, category: data.category }).success,
    completedPhotos: completedDescribe && Boolean(data.addressLine1 || data.timeWindows?.length || data.anyTime), completedWhere: false };
  draft.completedWhere = completedDescribe && !Object.keys(whereErrors(draft, new Date())).length;
  return draft;
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

function withServerWhere(data: JobDraft, server: JobDraft): JobDraft {
  const next = { ...data };
  for (const key of WHERE_SNAPSHOT_FIELDS) delete next[key];
  return jobDraftSchema.parse({ ...next, ...Object.fromEntries(WHERE_SNAPSHOT_FIELDS.filter(key => server[key] !== undefined).map(key => [key, server[key]])) });
}

/** A Describe-only cache cannot clear owned server fields that this device has never edited. */
export function inheritUneditedWhere(local: WizardDraft | null, server: JobDraft, authoritative: boolean): WizardDraft | null {
  if (!local || !authoritative || !server.postKey || local.data.postKey !== server.postKey || local.where) return local;
  return { ...local, data: withServerWhere(local.data, server) };
}

/** Recovery selects represented server fields; omitted partial raw fields remain local until Where is valid. */
export function recoverServerWizard(local: WizardDraft | null, server: JobDraft, manualCategory: boolean | null | undefined, confirmedWhereSave: boolean, now: Date): WizardDraft | null {
  const restored = recoverServerDescribe(local, server, manualCategory);
  if (!restored) return null;
  const confirmedWhere = confirmedWhereSave && !Object.keys(whereErrors(initialWizardDraft(server, true, manualCategory), now)).length;
  const previous = whereInputs(restored);
  const where = Object.fromEntries(Object.keys(WHERE_TEXT_LIMITS).map(name => {
    const key = name as keyof WhereInputs; const represented = server[key]; const raw = previous[key];
    const partial = !confirmedWhere && raw.trim() && !jobDraftSchema.shape[key].safeParse(raw).success;
    return [key, partial ? raw : typeof represented === "string" ? represented : ""];
  })) as WhereInputs;
  return { ...restored, where, data: withServerWhere(restored.data, server), completedWhere: confirmedWhere };
}

/** Canonical omission must never be mistaken for saving a partial postcode or other unfinished input. */
export function serverRepresentsWhere(draft: WizardDraft, saved: JobDraft = canonicalDraft(draft)): boolean {
  const canonical = canonicalDraft(draft); const raw = whereInputs(draft);
  return (Object.keys(WHERE_TEXT_LIMITS) as (keyof WhereInputs)[]).every(key => (saved[key] ?? "") === raw[key].trim())
    && saved.locationSource === canonical.locationSource && JSON.stringify(saved.point) === JSON.stringify(canonical.point)
    && (saved.asap ?? false) === (canonical.asap ?? false) && (saved.anyTime ?? false) === (canonical.anyTime ?? false)
    && JSON.stringify(saved.timeWindows ?? []) === JSON.stringify(canonical.timeWindows ?? []);
}

/** A step-owned save may preserve newer fields from another device; only its committed result proves durability. */
export function serverRepresentsInput(draft: WizardDraft, saved: JobDraft, manualCategory?: boolean | null): boolean {
  return saved.postKey === draft.data.postKey && typeof saved.description === "string" && saved.description === draft.description.trim()
    && saved.category === draft.data.category && (manualCategory ?? Boolean(saved.category)) === draft.manualCategory
    && serverRepresentsWhere(draft, saved);
}

/** Completed or unvisited other steps follow the committed server checkpoint; unfinished raw typing stays local. */
export function reconcileStepSave(draft: WizardDraft, saved: JobDraft, manualCategory: boolean | null, step: "describe" | "photos" | "where" | "review", now: Date): WizardDraft {
  let next = draft;
  if (step !== "describe" && draft.completedDescribe) {
    const describe = initialWizardDraft(saved, true, manualCategory);
    next = { ...next, description: describe.description, manualCategory: describe.manualCategory, completedDescribe: describe.completedDescribe,
      data: { ...next.data, description: saved.description, category: saved.category } };
  }
  if (step !== "where" && (!draft.where || draft.completedWhere)) {
    next = { ...next, data: withServerWhere(next.data, saved), ...(draft.where ? { where: whereInputs(initialWizardDraft(saved)) } : {}) };
    next = { ...next, completedWhere: !Object.keys(whereErrors(next, now)).length };
  }
  return next;
}

/** Later raw steps and local-only location hints cannot be discarded by a Describe recovery. */
export function canClearStaleDescribe(draft: WizardDraft, stored: WizardDraft | null): boolean {
  return Boolean(stored && stored.data.postKey === draft.data.postKey && !stored.locationHint && !draft.locationHint && !stored.where && !draft.where
    && Object.keys(stored.data).every(key => ["postKey", "description", "category", "photoPaths"].includes(key)));
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
  const raw = { ...whereInputs(draft), ...patch };
  const where = Object.fromEntries(Object.entries(WHERE_TEXT_LIMITS).map(([key, max]) => [key, raw[key as keyof WhereInputs].slice(0, max)])) as WhereInputs;
  const next = { ...draft, where, data: { ...draft.data, ...location }, completedWhere: false };
  return { ...next, data: canonicalDraft(next) };
}

export function whereErrors(draft: WizardDraft, now: Date): Record<string, string> {
  const input = { ...canonicalDraft(draft), photoPaths: draft.data.photoPaths ?? [], ...currentSchedule(draft.data, now) };
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
  return JSON.stringify({ version: 1, ownerId, data: canonicalDraft(draft), description: draft.description.slice(0, 1000), manualCategory: draft.manualCategory, completedDescribe: draft.completedDescribe, completedPhotos: draft.completedPhotos, completedWhere: draft.completedWhere, ...(draft.where ? { where: draft.where } : {}), ...(draft.locationHint ? { locationHint: locationHintSchema.parse(draft.locationHint) } : {}) });
}

export function decodeWizardDraft(raw: string | null, ownerId: string | null): WizardDraft | null {
  try {
    const stored = JSON.parse(raw ?? "null");
    if (!stored || stored.version !== 1 || stored.ownerId !== ownerId || typeof stored.description !== "string" || stored.description.length > 1000) return null;
    if (stored.where !== undefined && (!stored.where || typeof stored.where !== "object" || Array.isArray(stored.where)
      || Object.keys(stored.where).some(key => !Object.hasOwn(WHERE_TEXT_LIMITS, key))
      || Object.entries(WHERE_TEXT_LIMITS).some(([key, max]) => typeof stored.where[key] !== "string" || stored.where[key].length > max))) return null;
    const hint = stored.locationHint === undefined ? undefined : locationHintSchema.safeParse(stored.locationHint);
    if (hint && !hint.success) return null;
    const data = jobDraftSchema.safeParse(stored.data);
    return data.success ? { data: data.data, description: stored.description, manualCategory: stored.manualCategory === true, completedDescribe: stored.completedDescribe === true, completedPhotos: stored.completedPhotos === true, completedWhere: stored.completedWhere === true, ...(stored.where ? { where: stored.where as WhereInputs } : {}), ...(hint?.success ? { locationHint: hint.data } : {}) } : null;
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

/** A new home handoff edits Describe once, preserving the existing draft's key and later-step fields. */
export function applyLandingHandoff(draft: WizardDraft, handoff: JobDraft): WizardDraft {
  let next = draft;
  if (handoff.description !== undefined) next = editDescription({ ...draft, manualCategory: Boolean(handoff.category), data: { ...draft.data, category: handoff.category } }, handoff.description);
  if (handoff.category) next = { ...next, data: { ...next.data, category: handoff.category }, manualCategory: true, completedDescribe: false };
  return next;
}
