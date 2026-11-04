import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { CustomerJob, CustomerJobLoading, CustomerJobLoadError } from "@/components/jobs/CustomerJob";
import { JobWindows, JobWindowsLoadError } from "@/components/jobs/JobWindows";
import { CUSTOMER_JOB_PANELS, customerJobHref, customerJobReturn, customerJobShouldRefresh, customerJobWindowsReturn } from "@/lib/customer-job";
import { JOB_STATUSES } from "@/lib/job-status";
import { loadCustomerJobPage, loadCustomerJobPhotos } from "@/server/jobs/customer-page";
import { customerJobView } from "@/server/views";
import { exampleJob, VIEWERS } from "@/app/dev/components/job-views/preview-data";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const database = (row: ReturnType<typeof exampleJob> | null, error = false) => ({ job: { findUnique: vi.fn(async () => { if (error) throw new Error("private database failure"); return row; }) } }) as unknown as Pick<PrismaClient, "job">;

describe("customer job frame", () => {
  it("maps every server status to one panel and retains the shared labels/tracker", () => {
    expect(Object.keys(CUSTOMER_JOB_PANELS)).toEqual(JOB_STATUSES);
    for (const status of JOB_STATUSES) {
      const job = customerJobView(VIEWERS.customer, exampleJob({ status }))!;
      const html = renderToStaticMarkup(<CustomerJob job={job} />);
      expect(html).toContain(`data-panel="${CUSTOMER_JOB_PANELS[status].kind}"`);
      expect(html).toContain(`data-status="${status}"`);
      expect(html).toContain(job.title);
      expect(html).not.toMatch(/workerGrossCents|marginCents|estimates|Office-only/);
    }
  });
  it("renders cancelled jobs read-only without pretending that the job was completed or refunded", () => {
    const job = customerJobView(VIEWERS.customer, exampleJob({ status: "CANCELLED" }))!;
    const html = renderToStaticMarkup(<CustomerJob job={job} />);
    expect(html).toContain("This job was cancelled.");
    expect(html).toContain(job.description);
    expect(html).not.toMatch(/Job progress|Time windows|Edit job|Accept &amp; pay|Refund|Sorted/);
  });
  it("refreshes active statuses only while visible and online", () => {
    for (const status of JOB_STATUSES) {
      expect(customerJobShouldRefresh(status, true, "visible")).toBe(!["CANCELLED", "COMPLETED"].includes(status));
      expect(customerJobShouldRefresh(status, false, "visible")).toBe(false);
      expect(customerJobShouldRefresh(status, true, "hidden")).toBe(false);
    }
  });
  it("preserves customer home/list returns and rejects foreign, worker and malformed paths", () => {
    expect(customerJobReturn("/")).toBe("/");
    expect(customerJobReturn("/dashboard?tab=done&q=light")).toBe("/dashboard?tab=done&q=light");
    expect(customerJobReturn("/dashboard?tab=active&page=1&next=https://foreign.test")).toBe("/dashboard");
    for (const path of ["//evil.test/dashboard", "https://evil.test", "/jobs?view=all", "/dashboard/../admin", "/dashboard\\evil", "/dashboard\n", ["/dashboard"], undefined]) expect(customerJobReturn(path)).toBe("/");
  });
  it("keeps loading and recoverable error states named", () => {
    expect(renderToStaticMarkup(<CustomerJobLoading />)).toContain('aria-label="Loading job"');
    const error = renderToStaticMarkup(<CustomerJobLoadError />);
    expect(error).toContain("Couldn’t load the job."); expect(error).toContain("Try again");
  });
  it("returns from time windows to this job with bounded list context, while old entries keep Notifications", () => {
    const job = customerJobView(VIEWERS.customer, exampleJob())!;
    const back = customerJobHref(job.id, "/dashboard?tab=done&q=light&page=2&next=foreign");
    expect(customerJobWindowsReturn(job.id, back)).toBe(`/jobs/${job.id}?from=%2Fdashboard%3Ftab%3Ddone%26q%3Dlight%26page%3D2`);
    for (const value of [undefined, "https://foreign.test", `//foreign.test/jobs/${job.id}`, "/jobs/another-job", `/jobs/${job.id}?posted=1`, `/jobs/${job.id}?from=%2F&from=%2Fdashboard`]) expect(customerJobWindowsReturn(job.id, value)).toBe("/notifications");
    const initial = { id: job.id, jobNumber: job.jobNumber, title: job.title, editable: true, revision: job.updatedAt, schedule: { anyTime: true, asap: false, timeWindows: [] } };
    expect(renderToStaticMarkup(<JobWindows initial={initial} initialNow="2026-11-04T00:00:00Z" backHref={back} />)).toContain(`href="${back}"`);
    expect(renderToStaticMarkup(<JobWindowsLoadError backHref={back} />)).toContain(`href="${back}"`);
    expect(renderToStaticMarkup(<JobWindows initial={initial} initialNow="2026-11-04T00:00:00Z" />)).toContain('href="/notifications"');
  });
});

describe("owned customer page read", () => {
  it("returns the same not-found result for missing and foreign jobs", async () => {
    expect(await loadCustomerJobPage(database(null), VIEWERS.customer, "missing")).toEqual({ state: "not-found" });
    expect(await loadCustomerJobPage(database(exampleJob()), { ...VIEWERS.customer, userId: "foreign" }, "guessed")).toEqual({ state: "not-found" });
  });
  it("returns only the role DTO and signed visible photos, including a recoverable photo failure", async () => {
    const row = exampleJob();
    const result = await loadCustomerJobPhotos(customerJobView(VIEWERS.customer, row)!, VIEWERS.customer, async () => [
      { id: row.photos[0].id, position: 0, url: "https://signed.example.test/photo", expiresInSeconds: 300 },
      { id: "unprojected", position: 1, url: "https://signed.example.test/hidden", expiresInSeconds: 300 },
    ]);
    expect(result.photos).toEqual([{ src: "https://signed.example.test/photo", alt: `${row.title} · 1` }]);
    expect(JSON.stringify(result)).not.toMatch(/hidden|Office-only|marginCents|workerGrossCents|pricing|estimates/);
    expect(await loadCustomerJobPhotos(customerJobView(VIEWERS.customer, row)!, VIEWERS.customer, async () => { throw new Error("private storage path"); })).toMatchObject({ photosFailed: true, photos: [] });
  });
  it("does not leak read errors or call Storage for a job without photos", async () => {
    expect(await loadCustomerJobPage(database(null, true), VIEWERS.customer, "id")).toEqual({ state: "error" });
    const row = exampleJob({ photos: [] }), sign = vi.fn();
    expect(await loadCustomerJobPhotos(customerJobView(VIEWERS.customer, row)!, VIEWERS.customer, sign)).toMatchObject({ photos: [], photosFailed: false });
    expect(sign).not.toHaveBeenCalled();
  });
  it("renews near the signer's actual TTL, accounting for elapsed signing time and a new batch", async () => {
    const row = exampleJob(), job = customerJobView(VIEWERS.customer, row)!;
    for (const [expiresInSeconds, expected] of [[300, 266_000], [60, 26_000], [10, 1_000]]) {
      const now = vi.fn().mockReturnValueOnce(1_000).mockReturnValueOnce(5_000);
      const sign = async () => [{ id: row.photos[0].id, position: 0, url: "https://signed.example.test/photo", expiresInSeconds }];
      const first = await loadCustomerJobPhotos(job, VIEWERS.customer, sign, now);
      expect(first.photoLease?.renewAfterMs).toBe(expected);
      const next = await loadCustomerJobPhotos(job, VIEWERS.customer, sign, () => 5_000);
      expect(next.photoLease?.batchId).not.toBe(first.photoLease?.batchId);
    }
    const empty = await loadCustomerJobPhotos(customerJobView(VIEWERS.customer, exampleJob({ photos: [] }))!, VIEWERS.customer);
    expect(empty.photoLease).toBeNull();
  });
});
