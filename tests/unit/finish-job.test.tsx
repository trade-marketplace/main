import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FinishJob } from "@/components/jobs/worker/FinishJob";
import { finishExample } from "@/app/dev/components/finish-job/FinishDemo";
import { clearFinishReason, finishErrors, finishReasonKey, finishSpend, keepFinishReason, readFinishReason } from "@/lib/finish-job";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
const html = (job = finishExample) => renderToStaticMarkup(<FinishJob job={job} />);
const facts = { rule: finishExample.rule, photoCount: 2, cocFile: true, receipt: false, budgetCents: 8500, category: "ELECTRICAL" as const, extraWorkOpen: false };
describe("finish job form", () => {
  it("follows rule fields independently of the trade name and always shows Notes", () => {
    const body = html({ ...finishExample, category: "OTHER" }); expect(body).toContain("CoC number"); expect(body).toContain("CoC document");
    const noCoc = html({ ...finishExample, rule: { cocRequired: false, cocFileRequired: false, minPhotos: 0, notesRequired: true } });
    expect(noCoc).not.toContain("CoC number"); expect(noCoc).not.toContain("CoC document"); expect(noCoc).toContain("Notes"); expect(noCoc).toMatch(/required[^>]*name="notes"|name="notes"[^>]*required/);
    expect(finishErrors({ ...finishExample.fields, notes: "" }, { ...facts, rule: { ...facts.rule!, notesRequired: true } }).notes).toBeTruthy();
  });
  it("asks for a receipt only with positive spend on another trade, and hides a zero budget", () => {
    const other = { ...finishExample, category: "OTHER" as const, rule: { cocRequired: false, cocFileRequired: false, minPhotos: 1, notesRequired: true }, cocDocument: null };
    expect(html(other)).toContain('aria-label="Receipt"'); expect(html({ ...other, fields: { ...other.fields, spent: "0" } })).not.toContain('aria-label="Receipt"');
    expect(html()).not.toContain('aria-label="Receipt"'); expect(html({ ...other, budgetCents: 0 })).not.toContain("Materials spend");
    expect(finishErrors(finishExample.fields, { ...facts, category: "OTHER" }).receipt).toBeTruthy();
    expect(finishErrors({ ...finishExample.fields, spent: "0" }, { ...facts, category: "OTHER" }).receipt).toBeUndefined();
  });
  it("asks for an office reason only above the budget and uses the configured sign-off hours", () => {
    expect(html({ ...finishExample, fields: { ...finishExample.fields, spent: "85.00" } })).not.toContain("Why was it over?");
    expect(html({ ...finishExample, fields: { ...finishExample.fields, spent: "85.01" } })).toContain("Why was it over?");
    expect(finishErrors({ ...finishExample.fields, spent: "85.01" }, facts).reason).toBeTruthy();
    expect(finishErrors({ ...finishExample.fields, spent: "85.00" }, facts).reason).toBeUndefined();
    expect(html({ ...finishExample, autoReleaseHours: 72 })).toContain("Sarah gets 72 hours to check.");
  });
  it("disables Send until the exact declaration is ticked, and for missing rules or waiting extra work", () => {
    for (const job of [{ ...finishExample, fields: { ...finishExample.fields, declaration: false } }, { ...finishExample, rule: null }, { ...finishExample, extraWorkOpen: true }]) {
      expect(html(job)).toMatch(/<button[^>]*aria-disabled="true"[^>]*>[^]*?Send for sign-off/);
    }
    expect(html()).toContain("The work matches the job and any approved extras.");
    const body = html({ ...finishExample, readOnly: true }); expect(body).toContain("Sent for sign-off"); expect(body).not.toContain("Save for later"); expect(body).not.toContain("Send for sign-off"); expect(body).not.toContain("Remove ");
  });
  it("keeps document upload failure text inline with its own file, separate from photo feedback", () => {
    const body = renderToStaticMarkup(<FinishJob job={finishExample} preview="upload-error" />);
    const document = body.match(/aria-label="CoC document"[^]*?<\/section>/)?.[0];
    expect(document).toContain("Couldn’t upload this file. Try again.");
    expect(body.match(/aria-label="Photos of the finished work"[^]*?<\/section>/)?.[0]).not.toContain("Couldn’t upload this file. Try again.");
  });
  it.each([["72.50", 7250], ["0", 0], [" 2.05 ", 205], ["-1", null], ["1.001", null], ["1e2", null], ["NaN", null], ["21474836.48", null]])("validates money %s without floating dollar storage", (value, cents) => expect(finishSpend(value as string)).toBe(cents));
  it("keeps the bounded unsent reason only in its owner/job envelope, with honest storage failure", () => {
    const values = new Map<string, string>(), storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
    expect(keepFinishReason(storage, "owner", "job", "Cable needed replacing")).toBe(true);
    const raw = storage.getItem(finishReasonKey("owner", "job")); expect(readFinishReason(raw, "owner", "job")).toBe("Cable needed replacing");
    expect(readFinishReason(raw, "other", "job")).toBe(""); expect(readFinishReason(raw, "owner", "other")).toBe(""); expect(readFinishReason("bad", "owner", "job")).toBe("");
    expect(keepFinishReason({ ...storage, setItem: () => { throw Error("No storage"); } }, "owner", "job", "Reason")).toBe(false);
    expect(clearFinishReason({ ...storage, removeItem: () => {} }, "owner", "job")).toBe(false);
    expect(clearFinishReason(storage, "owner", "job")).toBe(true);
  });
});
