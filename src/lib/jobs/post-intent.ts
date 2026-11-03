import { z } from "zod";
import { DRAFT_STORAGE_KEY, POST_KEY_SCHEMA, postJobSchema } from "@/lib/job-draft";
import { currentSchedule } from "@/lib/job-time-windows";
import { canonicalDraft, decodeWizardDraft, encodeWizardDraft, type WizardDraft } from "@/lib/post-job-wizard";

export const POST_INTENT_STORAGE_KEY = "trade.job-post-intent.v1";
export const POST_INTENT_PARAM = "postIntent";
const schema = z.object({ version: z.literal(1), postKey: POST_KEY_SCHEMA, sourceOwnerId: z.uuid().nullable(), ownerId: z.uuid().nullable(), snapshot: z.string().max(20_000), photoIds: z.array(z.string().min(1).max(100)).max(6) }).strict();
export type PostIntent = z.infer<typeof schema>;

/** Only an actual Post-it gesture creates this bounded intent. A return URL alone never creates one. */
export function createPostIntent(draft: WizardDraft, ownerId: string | null, photoIds: readonly string[]): PostIntent {
  if (new Set(photoIds).size !== photoIds.length) throw new Error("Photo selection changed");
  return schema.parse({ version: 1, postKey: draft.data.postKey, sourceOwnerId: ownerId, ownerId, snapshot: encodeWizardDraft(draft, ownerId), photoIds: [...photoIds] });
}
export function decodePostIntent(raw: string | null): PostIntent | null {
  try {
    const parsed = schema.safeParse(JSON.parse(raw ?? "null"));
    if (!parsed.success || new Set(parsed.data.photoIds).size !== parsed.data.photoIds.length) return null;
    const draft = decodeWizardDraft(parsed.data.snapshot, parsed.data.sourceOwnerId);
    return draft?.data.postKey === parsed.data.postKey && (parsed.data.sourceOwnerId === null || parsed.data.sourceOwnerId === parsed.data.ownerId) ? parsed.data : null;
  } catch { return null; }
}
export function bindPostIntent(intent: PostIntent, ownerId: string): PostIntent | null {
  if (!z.uuid().safeParse(ownerId).success || intent.ownerId && intent.ownerId !== ownerId) return null;
  return { ...intent, ownerId };
}
export function postIntentDraft(intent: PostIntent): WizardDraft { return decodeWizardDraft(intent.snapshot, intent.sourceOwnerId)!; }
/** Owned upload paths replace guest bytes; all other reviewed content must still match the explicit gesture. */
export function matchesPostIntent(draft: WizardDraft, intent: PostIntent, now: Date): boolean {
  const canonical = (value: WizardDraft) => postJobSchema.safeParse({ ...canonicalDraft(value), ...currentSchedule(value.data, now), photoPaths: [] });
  const entered = canonical(draft); const reviewed = canonical(postIntentDraft(intent));
  return entered.success && reviewed.success && JSON.stringify(entered.data) === JSON.stringify(reviewed.data);
}

/** Verify persistence before leaving the guest's page for sign-up. No passwords or sessions enter this record. */
export function writePostIntent(storage: Pick<Storage, "setItem" | "getItem">, intent: PostIntent): boolean {
  try { const raw = JSON.stringify(intent); storage.setItem(POST_INTENT_STORAGE_KEY, raw); return storage.getItem(POST_INTENT_STORAGE_KEY) === raw; } catch { return false; }
}
export function clearPostedLocalDraft(storage: Pick<Storage, "getItem" | "removeItem">, ownerId: string | null, postKey: string): boolean {
  try {
    const raw = storage.getItem(DRAFT_STORAGE_KEY); const current = decodeWizardDraft(raw, ownerId);
    if (raw === null) return true;
    if (!current) { const envelope = JSON.parse(raw); return envelope?.ownerId !== ownerId; }
    if (current.data.postKey !== postKey) return true;
    storage.removeItem(DRAFT_STORAGE_KEY); return storage.getItem(DRAFT_STORAGE_KEY) === null;
  } catch { return false; }
}
export function clearPostIntent(storage: Pick<Storage, "getItem" | "removeItem">, ownerId: string | null, postKey: string): boolean {
  try {
    const raw = storage.getItem(POST_INTENT_STORAGE_KEY); const intent = decodePostIntent(raw);
    if (raw === null) return true;
    if (!intent) return false;
    if (intent.ownerId !== ownerId || intent.postKey !== postKey) return true;
    storage.removeItem(POST_INTENT_STORAGE_KEY); return storage.getItem(POST_INTENT_STORAGE_KEY) === null;
  } catch { return false; }
}
