import { describe, expect, it } from "vitest";

import { PEOPLE } from "../../prisma/seed/data.mjs";
import {
  defaultAccounts,
  defaultStatus,
  resolveEntry,
  resolvePlan,
  seededJobs,
  type JobStatus,
} from "../../scripts/screenshots/shots";

const STATUSES: JobStatus[] = [
  "REVIEW",
  "QUOTE_BOUNTY",
  "PRICED",
  "BOOKABLE",
  "ASSIGNED",
  "SUBMITTED",
  "COMPLETED",
  "CANCEL_REVIEW",
  "CANCELLED",
];

describe("who a route is shot as", () => {
  it("shoots public pages and log-in signed out", () => {
    expect(defaultAccounts("/how-it-works")).toEqual([null]);
    expect(defaultAccounts("/login")).toEqual([null]);
    expect(defaultAccounts("/help/[slug]")).toEqual([null]);
  });

  it("shoots / both signed out (landing) and as the customer (their home)", () => {
    expect(defaultAccounts("/")).toEqual([null, "customer"]);
  });

  it("signs in as the role the page is for", () => {
    expect(defaultAccounts("/jobs/new")).toEqual(["customer"]);
    expect(defaultAccounts("/jobs")).toEqual(["tradie"]);
    expect(defaultAccounts("/earnings")).toEqual(["tradie"]);
    expect(defaultAccounts("/admin")).toEqual(["office"]);
    expect(defaultAccounts("/admin/jobs/[id]/price")).toEqual(["office"]);
  });

  it("shoots a page both sides of a job see as each of them", () => {
    expect(defaultAccounts("/jobs/[id]")).toEqual(["customer", "tradie"]);
    expect(defaultAccounts("/messages")).toEqual(["customer", "tradie"]);
  });
});

describe("what if a route needs a job in a particular status?", () => {
  it("has a seeded job in every status", () => {
    const statuses = new Set(seededJobs().map((job) => job.status));
    for (const status of STATUSES) expect(statuses, status).toContain(status);
  });

  it("maps each job page to the status it's about", () => {
    expect(defaultStatus("/jobs/[id]/book", "tradie")).toBe("BOOKABLE");
    expect(defaultStatus("/jobs/[id]/complete", "tradie")).toBe("ASSIGNED");
    expect(defaultStatus("/jobs/[id]/help", "tradie")).toBe("ASSIGNED");
    expect(defaultStatus("/jobs/[id]/problem", "customer")).toBe("SUBMITTED");
    expect(defaultStatus("/receipts/[jobId]", "customer")).toBe("COMPLETED");
    expect(defaultStatus("/admin/jobs/[id]/price", "office")).toBe("REVIEW");
    expect(defaultStatus("/jobs/[id]", "customer")).toBe("PRICED");
    expect(defaultStatus("/jobs/[id]", "tradie")).toBe("BOOKABLE");
  });

  it("fills [id] with the seeded job in that status", () => {
    const { shots } = resolveEntry({ path: "/jobs/[id]/book" });
    const bookable = seededJobs().find((job) => job.status === "BOOKABLE");
    expect(shots).toEqual([
      expect.objectContaining({
        url: `/jobs/${bookable?.id}/book`,
        account: "tradie",
        status: "BOOKABLE",
        expectMode: "trade",
      }),
    ]);
  });

  it("takes the status from `status=` when the PR gives one, for every status", () => {
    for (const status of STATUSES) {
      const { shots, skipped } = resolveEntry({ path: "/jobs/[id]", role: "customer", status });
      expect(skipped, status).toEqual([]);
      const job = seededJobs().find((candidate) => candidate.id === shots[0].url.split("/")[2]);
      expect(job?.status).toBe(status);
      expect(shots[0].label).toBe(`/jobs/[id] · customer · ${status}`);
    }
  });

  it("signs in as the tradie doing the job, switching to the other demo worker when it's theirs", () => {
    const assigned = resolveEntry({ path: "/jobs/[id]/complete" }).shots[0];
    expect(assigned.account).toBe("tradie");
    expect(seededJobs().find((job) => job.id === assigned.url.split("/")[2])?.worker).toBe("tradie");

    const submitted = resolveEntry({ path: "/jobs/[id]/complete", status: "SUBMITTED" }).shots[0];
    expect(submitted.account).toBe("otherWorker");
    expect(submitted.label).toBe("/jobs/[id]/complete · worker · SUBMITTED");
  });

  it("fills the office's and receipts' job ids too", () => {
    expect(resolveEntry({ path: "/admin/jobs/[id]/price" }).shots[0].url).toMatch(/^\/admin\/jobs\/de0+-.+\/price$/);
    expect(resolveEntry({ path: "/receipts/[jobId]" }).shots[0].status).toBe("COMPLETED");
  });
});

describe("resolveEntry", () => {
  it("keeps query flags for states", () => {
    const { shots } = resolveEntry({ path: "/jobs?state=empty" });
    expect(shots).toEqual([
      expect.objectContaining({
        url: "/jobs?state=empty",
        label: "/jobs?state=empty · tradie",
        id: "jobs-state-empty-tradie",
      }),
    ]);
  });

  it("uses the role the PR asks for", () => {
    expect(resolveEntry({ path: "/", role: "guest" }).shots.map((shot) => shot.account)).toEqual([null]);
    expect(resolveEntry({ path: "/jobs", role: "worker" }).shots[0]).toMatchObject({
      account: "otherWorker",
      expectMode: "trade",
    });
    expect(resolveEntry({ path: "/admin", role: "office" }).shots[0].expectMode).toBe("office");
  });

  it("names the home page's shots by role", () => {
    expect(resolveEntry({ path: "/" }).shots.map((shot) => [shot.id, shot.label, shot.expectMode])).toEqual([
      ["home-signed-out", "/ · signed out", null],
      ["home-customer", "/ · customer", "customer"],
    ]);
  });

  it("fills sample trade, city and tradie params", () => {
    expect(resolveEntry({ path: "/[trade]/[city]" }).shots[0].url).toBe("/electrical/invercargill");
    expect(resolveEntry({ path: "/tradies/[id]" }).shots[0].url).toBe(`/tradies/${PEOPLE.tradie.id}`);
  });

  it("skips a param it can't fill, saying how to list it", () => {
    const { shots, skipped } = resolveEntry({ path: "/help/[slug]" });
    expect(shots).toEqual([]);
    expect(skipped[0].reason).toContain("/help/some-slug");
  });

  it("accepts a real URL as it is", () => {
    expect(resolveEntry({ path: "/help/getting-started" }).shots[0].url).toBe("/help/getting-started");
  });
});

describe("resolvePlan", () => {
  it("makes duplicate file names unique", () => {
    const { shots } = resolvePlan([{ path: "/jobs" }, { path: "/jobs/" }]);
    expect(shots.map((shot) => shot.id)).toEqual(["jobs-tradie", "jobs-tradie-2"]);
  });
});
