import { describe, expect, it } from "vitest";
import { jobDraftSchema } from "@/lib/job-draft";
import { canonicalDraft, decodeWizardDraft, describeErrors, editDescription, encodeWizardDraft, guessJobType, initialWizardDraft, landingWizardDraft } from "@/lib/post-job-wizard";

describe("Describe step", () => {
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
