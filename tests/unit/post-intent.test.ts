import { describe, expect, it } from "vitest";
import { DRAFT_STORAGE_KEY } from "@/lib/job-draft";
import { initialWizardDraft, encodeWizardDraft } from "@/lib/post-job-wizard";
import { abandonPostIntent, bindPostIntent, clearPostIntent, clearPostedLocalDraft, createPostIntent, decodePostIntent, matchesPostIntent, POST_INTENT_STORAGE_KEY, writePostIntent } from "@/lib/jobs/post-intent";

const owner = "11111111-1111-4111-8111-111111111113";
const other = "11111111-1111-4111-8111-111111111114";
const key = "9b58063b-12c2-4b46-9c45-38353f41173e";
const draft = initialWizardDraft({ postKey: key, description: "Repair the leaking tap downstairs.", category: "PLUMBING" }, true);
function memory() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
describe("explicit owner-bound posting intent", () => {
  it("abandons only the exact attempted intent, retaining newer-tab intent and all guest draft content", () => {
    const storage = memory(); const raw = JSON.stringify(createPostIntent(draft, null, ["original"]));
    storage.setItem(POST_INTENT_STORAGE_KEY, raw); storage.setItem(DRAFT_STORAGE_KEY, encodeWizardDraft(draft, null));
    const original = storage.getItem(DRAFT_STORAGE_KEY);
    const newer = JSON.stringify(createPostIntent({ ...draft, description: "Repair the other tap upstairs." }, null, ["newer"]));
    storage.setItem(POST_INTENT_STORAGE_KEY, newer); abandonPostIntent(storage, [raw]);
    expect(storage.getItem(POST_INTENT_STORAGE_KEY)).toBe(newer);
    storage.setItem(POST_INTENT_STORAGE_KEY, raw); abandonPostIntent(storage, [raw]);
    expect(storage.getItem(POST_INTENT_STORAGE_KEY)).toBeNull(); expect(storage.getItem(DRAFT_STORAGE_KEY)).toBe(original);
    expect(() => abandonPostIntent({ getItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } }, [raw])).not.toThrow();
  });
  it("never automatically posts content edited after the original Post-it gesture", () => {
    const complete = { ...draft, data: { ...draft.data, photoPaths: [], addressLine1: "1 Example Street", suburb: "Gladstone", city: "Invercargill", locationSource: "TYPED" as const, anyTime: true } };
    const intent = createPostIntent(complete, null, ["one"]); const now = new Date("2026-11-04T00:00:00Z");
    expect(matchesPostIntent({ ...complete, data: { ...complete.data, photoPaths: ["owned-upload"] } }, intent, now)).toBe(true);
    expect(matchesPostIntent({ ...complete, description: "Repair a different tap upstairs." }, intent, now)).toBe(false);
    expect(matchesPostIntent({ ...complete, data: { ...complete.data, addressLine1: "2 Example Street" } }, intent, now)).toBe(false);
  });
  it("retains the exact guest draft and photo order without weakening the ordinary owner decoder", () => {
    const intent = createPostIntent(draft, null, ["second", "first"]);
    expect(decodePostIntent(JSON.stringify(intent))).toEqual(intent);
    expect(bindPostIntent(intent, owner)?.ownerId).toBe(owner);
    expect(bindPostIntent(bindPostIntent(intent, owner)!, other)).toBeNull();
    expect(() => createPostIntent(draft, null, ["one", "one"])).toThrow();
  });
  it("rejects malformed, mismatched, oversized or another owner's stored snapshots", () => {
    const intent = createPostIntent(draft, owner, []);
    for (const changed of [{ postKey: other }, { sourceOwnerId: other }, { photoIds: ["one", "one"] }, { photoIds: Array(7).fill("one") }, { snapshot: "x".repeat(20_001) }]) expect(decodePostIntent(JSON.stringify({ ...intent, ...changed }))).toBeNull();
    expect(decodePostIntent(null)).toBeNull();
  });
  it("requires verified device persistence before leaving for signup", () => {
    const storage = memory(); const intent = createPostIntent(draft, null, []);
    expect(writePostIntent(storage, intent)).toBe(true);
    expect(decodePostIntent(storage.getItem(POST_INTENT_STORAGE_KEY))).toEqual(intent);
    expect(writePostIntent({ setItem() { throw new Error("quota"); }, getItem: storage.getItem }, intent)).toBe(false);
    expect(writePostIntent({ setItem() {}, getItem: () => null }, intent)).toBe(false);
  });
  it("only clears metadata for the posted owner/key, preserving newer or different-account drafts", () => {
    const storage = memory(); storage.setItem(DRAFT_STORAGE_KEY, encodeWizardDraft(draft, other));
    expect(clearPostedLocalDraft(storage, owner, key)).toBe(true); expect(storage.getItem(DRAFT_STORAGE_KEY)).not.toBeNull();
    const newer = { ...draft, data: { ...draft.data, postKey: other } };
    storage.setItem(DRAFT_STORAGE_KEY, encodeWizardDraft(newer, owner));
    expect(clearPostedLocalDraft(storage, owner, key)).toBe(true); expect(storage.getItem(DRAFT_STORAGE_KEY)).not.toBeNull();
    storage.setItem(DRAFT_STORAGE_KEY, encodeWizardDraft(draft, owner));
    expect(clearPostedLocalDraft(storage, owner, key)).toBe(true); expect(storage.getItem(DRAFT_STORAGE_KEY)).toBeNull();
    writePostIntent(storage, createPostIntent(draft, owner, []));
    expect(clearPostIntent(storage, other, key)).toBe(true); expect(storage.getItem(POST_INTENT_STORAGE_KEY)).not.toBeNull();
    expect(clearPostIntent(storage, owner, key)).toBe(true); expect(storage.getItem(POST_INTENT_STORAGE_KEY)).toBeNull();
  });
  it("reports blocked cleanup without claiming the consumed envelope was removed", () => {
    const storage = memory(); storage.setItem(DRAFT_STORAGE_KEY, encodeWizardDraft(draft, owner));
    expect(clearPostedLocalDraft({ getItem: storage.getItem, removeItem() { throw new Error("blocked"); } }, owner, key)).toBe(false);
  });
});
