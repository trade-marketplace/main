import { describe, expect, it } from "vitest";
import { jobDraftSchema } from "@/lib/job-draft";
import { applyLandingHandoff, canClearStaleDescribe, canonicalDraft, decodeWizardDraft, describeErrors, editDescription, encodeWizardDraft, guessJobType, initialWizardDraft, landingLocationHint, landingWizardDraft, localEnvelopeMatchesInput, recoverServerDescribe } from "@/lib/post-job-wizard";

describe("Describe step", () => {
  it("recovers represented server Describe fields while retaining key-bound local-only hints and later fields", () => {
    const key = "9b58063b-12c2-4b46-9c45-38353f41173e";
    const local = { ...initialWizardDraft({ postKey: key, description: "Repair a leaking tap", category: "PLUMBING", photoPaths: ["cached-photo"], addressLine1: "1 Example Street" }), locationHint: { label: "Bluff", point: null } };
    const server = { postKey: key, description: "Check the lights and wiring upstairs", category: "ELECTRICAL" as const };
    expect(recoverServerDescribe(local, server, false)).toMatchObject({ description: server.description, manualCategory: false, completedDescribe: true, locationHint: local.locationHint, data: { category: "ELECTRICAL", photoPaths: local.data.photoPaths, addressLine1: local.data.addressLine1 } });
    expect(recoverServerDescribe(local, { ...server, category: undefined }, false)?.completedDescribe).toBe(false);
    expect(recoverServerDescribe(local, { ...server, postKey: "other-key" }, false)).toBeNull();
    expect(local).toMatchObject({ description: "Repair a leaking tap", data: { postKey: key, category: "PLUMBING" }, locationHint: { label: "Bluff", point: null } });
    expect(recoverServerDescribe(null, server, false)).toBeNull();
  });
  it("only clears a stale Describe envelope when its local-only content can safely be replaced", () => {
    const draft = initialWizardDraft({ postKey: "9b58063b-12c2-4b46-9c45-38353f41173e", description: "Repair a leaking tap", category: "PLUMBING", photoPaths: [] });
    expect(canClearStaleDescribe(draft, draft)).toBe(true); expect(canClearStaleDescribe(draft, null)).toBe(false);
    expect(canClearStaleDescribe(draft, { ...draft, data: { ...draft.data, postKey: "other-key" } })).toBe(false);
    expect(canClearStaleDescribe(draft, { ...draft, locationHint: { label: "Bluff", point: null } })).toBe(false);
    expect(canClearStaleDescribe(draft, { ...draft, data: { ...draft.data, addressLine1: "Unsubmitted later state" } })).toBe(false);
  });
  it("refuses server-only exit when a readable local envelope would restore older input", () => {
    const draft = initialWizardDraft({ postKey: "9b58063b-12c2-4b46-9c45-38353f41173e", description: "Check the lights upstairs", category: "ELECTRICAL" });
    expect(localEnvelopeMatchesInput(draft, null)).toBe(true); expect(localEnvelopeMatchesInput(draft, draft)).toBe(true);
    for (const stored of [{ ...draft, description: "Old description" }, { ...draft, manualCategory: !draft.manualCategory }, { ...draft, data: { ...draft.data, category: "PLUMBING" as const } }, { ...draft, data: { ...draft.data, postKey: undefined } }, { ...draft, locationHint: { label: "Bluff", point: null } }]) expect(localEnvelopeMatchesInput(draft, stored)).toBe(false);
    expect(localEnvelopeMatchesInput({ ...draft, locationHint: { label: "Bluff", point: null } }, null)).toBe(false);
    // Current server photo reconciliation handles redundant cached paths independently of entered text.
    expect(localEnvelopeMatchesInput(draft, { ...draft, data: { ...draft.data, photoPaths: ["older-cache"] } })).toBe(true);
  });
  it("keeps bounded landing location hints outside the canonical address and across owner-bound restoration", () => {
    const hint = landingLocationHint({ location: "Bluff", lat: "-46.599", lng: "168.345" });
    const draft = { ...initialWizardDraft({ postKey: "9b58063b-12c2-4b46-9c45-38353f41173e", description: "Repair a leaking tap", category: "PLUMBING" }, true), locationHint: hint };
    expect(hint).toEqual({ label: "Bluff", point: { lat: -46.599, lng: 168.345 } });
    expect(canonicalDraft(draft)).not.toHaveProperty("point"); expect(canonicalDraft(draft)).not.toHaveProperty("locationHint");
    const stored = decodeWizardDraft(encodeWizardDraft(draft, "owner"), "owner")!;
    expect(stored).toMatchObject({ locationHint: hint, completedDescribe: true }); expect(localEnvelopeMatchesInput(draft, stored)).toBe(true);
    expect(localEnvelopeMatchesInput(draft, null)).toBe(false); expect(localEnvelopeMatchesInput(draft, { ...stored, data: {} })).toBe(false);
    expect(decodeWizardDraft(encodeWizardDraft(draft, "owner"), "another")).toBeNull();
  });
  it("bounds location labels and rejects invalid coordinates without turning a hint into an address", () => {
    expect(landingLocationHint({ location: "x".repeat(1000) })?.label).toHaveLength(80);
    for (const lat of ["91", "NaN", "Infinity", ""]) expect(landingLocationHint({ location: "Bluff", lat, lng: "168.345" })?.point).toBeNull();
    expect(landingLocationHint({ location: ["Bluff"] })).toBeUndefined(); expect(landingLocationHint({ location: " " })).toBeUndefined();
    const draft = initialWizardDraft(); const raw = JSON.parse(encodeWizardDraft(draft, null)); raw.locationHint = { label: "Bluff", point: { lat: 999, lng: 0 } };
    expect(decodeWizardDraft(JSON.stringify(raw), null)).toBeNull();
    raw.locationHint = { label: "Bluff" }; expect(decodeWizardDraft(JSON.stringify(raw), null)).toBeNull();
  });
  it("applies a new landing description/type over an existing draft without resetting its private later fields", () => {
    const original = initialWizardDraft({ postKey: "9b58063b-12c2-4b46-9c45-38353f41173e", description: "Fix the fence", category: "CONSTRUCTION", photoPaths: ["private/photo.webp"], addressLine1: "1 Example St", suburb: "Gladstone", city: "Invercargill" }, true);
    const inferred = applyLandingHandoff(original, landingWizardDraft({ description: "Repair a leaking tap" }));
    expect(inferred).toMatchObject({ description: "Repair a leaking tap", manualCategory: false, completedDescribe: false, data: { postKey: original.data.postKey, category: "PLUMBING", photoPaths: original.data.photoPaths, addressLine1: "1 Example St" } });
    const explicit = applyLandingHandoff(inferred, landingWizardDraft({ type: "electrical" }));
    expect(explicit).toMatchObject({ description: "Repair a leaking tap", manualCategory: true, completedDescribe: false, data: { category: "ELECTRICAL", postKey: original.data.postKey } });
    expect(applyLandingHandoff(original, {})).toBe(original);
  });
  it("keeps homepage free-text inference editable but preserves an explicit landing type", () => {
    const inferred = initialWizardDraft(landingWizardDraft({ description: "Fix the fence" }));
    expect(inferred).toMatchObject({ manualCategory: false, data: { category: "CONSTRUCTION" } });
    expect(editDescription(inferred, "Repair a leaking tap").data.category).toBe("PLUMBING");
    const explicit = initialWizardDraft(landingWizardDraft({ description: "Fix the fence", type: "construction" }));
    expect(explicit.manualCategory).toBe(true); expect(editDescription(explicit, "Repair a leaking tap").data.category).toBe("CONSTRUCTION");
  });
  it("restores inferred and explicit server categories without guessing their origin from matching words", () => {
    const data = { description: "Repair a leaking tap downstairs", category: "PLUMBING" as const };
    const inferred = initialWizardDraft(data, true, false);
    expect(editDescription(inferred, "Check the lights and wiring upstairs").data.category).toBe("ELECTRICAL");
    const manual = initialWizardDraft(data, true, true);
    expect(editDescription(manual, "Check the lights and wiring upstairs").data.category).toBe("PLUMBING");
    expect(initialWizardDraft(data, true, null).manualCategory).toBe(true);
    expect(canonicalDraft(inferred)).toEqual(data);
  });
  it.each([
    ["Lights keep flickering", "ELECTRICAL"], ["A leaking tap", "PLUMBING"], ["Install gas hob", "GAS"],
    ["Build a deck", "CONSTRUCTION"], ["Moving a sofa", "OTHER"], ["Not sure what needs fixing", "OTHER"],
    ["Need something done", undefined],
  ])("guesses %s as an editable hint", (description, expected) => {
    expect(guessJobType(description)).toBe(expected);
  });
  it("revises a guess as text changes, but keeps an explicit customer choice", () => {
    const guessed = editDescription(initialWizardDraft(), "Lights keep flickering");
    expect(guessed.data.category).toBe("ELECTRICAL");
    expect(editDescription(guessed, "Fix the leaking tap").data.category).toBe("PLUMBING");
    expect(editDescription({ ...guessed, manualCategory: true }, "Fix the leaking tap").data.category).toBe("ELECTRICAL");
    expect(editDescription(guessed, "Something else").data.category).toBeUndefined();
  });
  it("editing a completed description requires Next again, even when the new text is valid", () => {
    const draft = initialWizardDraft({ description: "Move a sofa upstairs", category: "OTHER" }, true);
    expect(editDescription(draft, "Assemble a garden bench").completedDescribe).toBe(false);
  });
  it("only resumes Photos from a complete saved Describe, not a guess on a partial server draft", () => {
    expect(initialWizardDraft({ description: "Lights keep flickering" }, true).completedDescribe).toBe(false);
    expect(initialWizardDraft({ description: "Lights keep flickering", category: "ELECTRICAL", photoPaths: [] }, true).completedDescribe).toBe(true);
  });
  it("uses the shared schema and field prompts on Next", () => {
    expect(describeErrors(initialWizardDraft())).toEqual({ description: "Describe the job", category: "Type of job" });
    expect(describeErrors(initialWizardDraft({ description: "Too short", category: "OTHER" }))).toEqual({ description: "Describe the job" });
    expect(describeErrors(initialWizardDraft({ description: "Move a sofa upstairs", category: "OTHER" }))).toEqual({});
  });
  it("keeps all later-step data and one post key when describing the job again", () => {
    const draft = initialWizardDraft({ postKey: "9b58063b-12c2-4b46-9c45-38353f41173e", description: "Move a sofa upstairs", category: "OTHER", photoPaths: ["private/photo.webp"], suburb: "Wellington", anyTime: true });
    expect(canonicalDraft(editDescription(draft, "Assemble a garden bench"))).toEqual({ ...draft.data, description: "Assemble a garden bench" });
  });
});

describe("owner-bound local draft", () => {
  it("restores unfinished typing while keeping the canonical payload valid", () => {
    const draft = editDescription(initialWizardDraft({ description: "Old valid description", category: "ELECTRICAL" }), "Li");
    const raw = encodeWizardDraft(draft, "customer-a");
    expect(decodeWizardDraft(raw, "customer-a")?.description).toBe("Li");
    expect(canonicalDraft(draft)).toEqual({ category: "ELECTRICAL" });
    expect(jobDraftSchema.safeParse(canonicalDraft(draft)).success).toBe(true);
  });
  it("restores completion independently of field validity and keeps it out of the shared server payload", () => {
    const draft = initialWizardDraft({ description: "Move a sofa upstairs", category: "OTHER" });
    expect(decodeWizardDraft(encodeWizardDraft(draft, null), null)?.completedDescribe).toBe(false);
    expect(decodeWizardDraft(encodeWizardDraft({ ...draft, completedDescribe: true }, null), null)?.completedDescribe).toBe(true);
    expect(canonicalDraft({ ...draft, completedDescribe: true })).toEqual({ description: "Move a sofa upstairs", category: "OTHER" });
  });
  it("resumes a validated server Describe while incomplete server fields still require Next", () => {
    expect(initialWizardDraft({ description: "Move a sofa upstairs", category: "OTHER" }, true).completedDescribe).toBe(true);
    expect(initialWizardDraft({ description: "Move a sofa upstairs" }, true).completedDescribe).toBe(false);
    expect(initialWizardDraft({ category: "OTHER" }, true).completedDescribe).toBe(false);
    expect(initialWizardDraft({ description: "Move a sofa upstairs", category: "OTHER" }).completedDescribe).toBe(false);
  });
  it("never restores another account's draft or an account draft to a guest", () => {
    const raw = encodeWizardDraft(initialWizardDraft({ description: "A private description", category: "OTHER" }), "customer-a");
    expect(decodeWizardDraft(raw, "customer-b")).toBeNull();
    expect(decodeWizardDraft(raw, null)).toBeNull();
    const guest = encodeWizardDraft(initialWizardDraft(), null);
    expect(decodeWizardDraft(guest, null)).not.toBeNull();
    expect(decodeWizardDraft(guest, "customer-a")).toBeNull();
  });
  it("rejects corrupt, oversized, unversioned or unvalidated stored data", () => {
    for (const raw of ["broken", "null", JSON.stringify({ description: "Legacy draft" }), JSON.stringify({ version: 1, ownerId: null, description: "x".repeat(1001), data: {} }), JSON.stringify({ version: 1, ownerId: null, description: "Hello", data: { category: "FAKE" } })]) {
      expect(decodeWizardDraft(raw, null)).toBeNull();
    }
  });
  it("bounds landing hints and does not invent a category for an unknown type", () => {
    expect(landingWizardDraft({ description: "Lights flicker", type: "electrical" })).toEqual({ description: "Lights flicker", category: "ELECTRICAL" });
    expect(landingWizardDraft({ description: "x".repeat(500), type: "FAKE" }).description).toHaveLength(120);
    expect(landingWizardDraft({ type: ["electrical"] })).toEqual({});
  });
});
