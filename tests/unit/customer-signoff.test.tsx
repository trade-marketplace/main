import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SignoffPanel } from "@/components/jobs/customer/SignoffPanel";
import { CustomerJob } from "@/components/jobs/CustomerJob";
import { SIGNOFF_REVIEW_TAGS, signoffHoursLeft, signoffReviewSchema, type CustomerSignoff } from "@/lib/customer-signoff";
import { exampleJob, VIEWERS } from "@/app/dev/components/job-views/preview-data";
import { customerJobView } from "@/server/views";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const job = customerJobView(VIEWERS.customer, exampleJob({ status: "SUBMITTED" }))!;
const data: CustomerSignoff = { cocNumber: "2026-118734", cocUrl: "https://files.example.test/signed-certificate", cocFileLabel: "PDF", photos: [{ id: "photo", url: "https://files.example.test/signed-photo" }], notes: "Finished notes.", submittedAt: "2026-11-11T00:00:00Z", releaseAt: "2026-11-13T00:00:00Z", autoReleaseHours: 48, hoursLeft: 46, problemOpen: false, autoCompleted: false, filesUnavailable: false, filesRenewAfterMs: 270000 };
function render(preview = "electrical", input = data) { return renderToStaticMarkup(<SignoffPanel job={job} data={input} online problemHref={`/jobs/${job.id}/problem?from=test`} preview={preview} />); }

describe("customer please-check panel", () => {
  it("shows evidence before the optional rating and only shows a comment box after choosing a star", () => {
    const plain = render(), rated = render("rated");
    expect(plain.indexOf("Certificate of Compliance")).toBeLessThan(plain.indexOf("Rate Jack"));
    expect(plain).toContain("CoC 2026-118734 · PDF"); expect(plain).toContain('target="_blank"'); expect(plain).toContain("noopener noreferrer");
    expect(plain).not.toContain("Add a comment (optional)"); expect(rated).toContain("Add a comment (optional)");
    for (const tag of SIGNOFF_REVIEW_TAGS) expect(rated).toContain(tag);
    expect(plain).toContain("Yes, all sorted"); expect(plain).toContain("Something’s not right"); expect(plain).toContain("46h left");
  });
  it("uses the actual setting and submitted timestamp for the countdown", () => {
    const submitted = new Date("2026-11-11T00:00:00Z"), now = new Date("2026-11-11T02:00:00Z");
    expect(signoffHoursLeft(submitted, 48, now)).toBe(46); expect(signoffHoursLeft(submitted, 72, now)).toBe(70); expect(signoffHoursLeft(submitted, 1, now)).toBe(0); expect(signoffHoursLeft(null, 48, now)).toBeNull();
    expect(render("paused", { ...data, problemOpen: true })).toContain("Auto-release is paused while your report is open.");
    expect(render("paused", { ...data, problemOpen: true })).not.toMatch(/46h left|No reply in 48 hours/);
  });
  it("validates only whole ratings, exactly the four tags and a bounded optional comment", () => {
    expect(signoffReviewSchema.safeParse({ rating: 5, tags: [...SIGNOFF_REVIEW_TAGS], comment: "x".repeat(1000) }).success).toBe(true);
    for (const review of [{ rating: 0, tags: [] }, { rating: 5.5, tags: [] }, { rating: 3, tags: ["Made up"] }, { rating: 4, tags: [], comment: "x".repeat(1001) }]) expect(signoffReviewSchema.safeParse(review).success).toBe(false);
  });
  it.each([[1, "1 hour"], [48, "48 hours"], [72, "72 hours"]])("describes the configured %s-hour deadline", (autoReleaseHours, duration) => {
    const html = render("electrical", { ...data, autoReleaseHours: Number(autoReleaseHours) });
    expect(html).toContain(`No reply in ${duration} and we’ll mark it done.`);
    if (autoReleaseHours !== 48) expect(html).not.toContain("No reply in 48 hours");
  });
  it("keeps notes as plain text, with no worker earnings, margins or materials displayed", () => {
    const html = render("photos", { ...data, notes: "<script>unsafe()</script>", cocNumber: null, cocUrl: null });
    expect(html).toContain("&lt;script&gt;"); expect(html).not.toContain("<script>");
    expect(html).not.toMatch(/Worker rate|Materials|Estimate|Margin|Your earnings|\$70|\$38/);
  });
  it("shows a retry for missing file links, retains notes and never adds an unavailable View link", () => {
    const html = render("files-unavailable", { ...data, cocUrl: null, photos: [{ id: "photo", url: null }], filesUnavailable: true });
    expect(html).toContain("Can’t load the files."); expect(html).toContain("Try again"); expect(html).toContain("Finished notes."); expect(html).not.toContain('target="_blank"');
  });
  it("labels a permitted certificate image truthfully and keeps the same new-tab viewer", () => {
    const html = render("certificate-photo", { ...data, cocFileLabel: "Photo" });
    expect(html).toContain("CoC 2026-118734 · Photo"); expect(html).not.toContain("CoC 2026-118734 · PDF"); expect(html).toContain('target="_blank"');
  });
  it.each([1, 72])("the completed panel describes automatic completion without claiming the current %s-hour setting was used", autoReleaseHours => {
    const completed = { ...job, status: "COMPLETED" as const };
    const html = renderToStaticMarkup(<CustomerJob job={completed} signoffData={{ ...data, autoReleaseHours, autoCompleted: true }} preview="static" />);
    expect(html).toContain("We marked this done automatically."); expect(html).not.toMatch(/We marked this done after/);
    expect(renderToStaticMarkup(<CustomerJob job={completed} signoffData={data} preview="static" />)).not.toContain("We marked this done automatically.");
  });
});
