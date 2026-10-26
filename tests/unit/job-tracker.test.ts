import { describe, expect, it } from "vitest";

import { JOB_STATUSES } from "@/lib/job-status";
import { jobTracker } from "@/lib/job-tracker";

const labels = (status: Parameters<typeof jobTracker>[0], audience: Parameters<typeof jobTracker>[1], options = {}) =>
  jobTracker(status, audience, options)?.steps.map((s) => s.label);

describe("jobTracker", () => {
  it("shows the customer's whole journey before they pay, with the price step now", () => {
    expect(jobTracker("REVIEW", "customer")).toMatchObject({ current: 1 });
    expect(labels("REVIEW", "customer")).toEqual(["Posted", "Getting your price", "Accept & pay", "Tradie on the way", "Sorted"]);
    expect(labels("QUOTE_BOUNTY", "customer")?.[1]).toBe("Quick look");
    expect(jobTracker("PRICED", "customer")?.current).toBe(2);
  });

  it("folds the early steps into “Price accepted” once paid", () => {
    expect(labels("BOOKABLE", "customer")).toEqual(["Posted", "Price accepted", "Tradie on the way", "Sorted"]);
    expect(labels("ASSIGNED", "customer")).toEqual(["Price accepted", "Tradie confirmed", "Sorted"]);
  });

  it("names the tradie, and says when extra work needs the customer's OK", () => {
    expect(jobTracker("ASSIGNED", "customer", { tradieName: "Jack Wilson" })?.steps[1].note).toBe("Jack Wilson");
    expect(jobTracker("ASSIGNED", "customer", { extraWork: true })?.steps[1].note).toBe("Extra work needs your OK");
  });

  it("marks every step done once sorted", () => {
    const done = jobTracker("COMPLETED", "customer");
    expect(done?.current).toBe(done?.steps.length);
  });

  it("gives the tradie a tracker only once they've claimed the job", () => {
    for (const status of ["REVIEW", "QUOTE_BOUNTY", "PRICED", "BOOKABLE", "CANCEL_REVIEW", "CANCELLED"] as const) {
      expect(jobTracker(status, "tradie"), status).toBeNull();
    }
    expect(jobTracker("ASSIGNED", "tradie")?.current).toBe(1);
    expect(jobTracker("SUBMITTED", "tradie")?.current).toBe(3);
  });

  it("asks electrical jobs for a CoC and other trades for photos", () => {
    expect(labels("ASSIGNED", "tradie")?.[2]).toBe("Upload CoC");
    expect(labels("ASSIGNED", "tradie", { evidence: "photos" })?.[2]).toBe("Upload photos");
  });

  it("shows the tradie's pay step until the payout is paid", () => {
    expect(jobTracker("COMPLETED", "tradie", { payout: "QUEUED" })?.current).toBe(4);
    expect(jobTracker("COMPLETED", "tradie", { payout: "PAID" })?.current).toBe(5);
  });

  it("says who the tradie is waiting on for extra work", () => {
    expect(jobTracker("ASSIGNED", "tradie", { extraWork: true, customerFirstName: "Sarah" })?.steps[1].note).toBe(
      "Waiting on Sarah to approve extra work",
    );
    expect(jobTracker("ASSIGNED", "tradie", { extraWork: true })?.steps[1].note).toBe(
      "Waiting on the customer to approve extra work",
    );
  });

  it("has no tracker for the office or a cancelled job", () => {
    for (const status of JOB_STATUSES) expect(jobTracker(status, "office")).toBeNull();
    expect(jobTracker("CANCELLED", "customer")).toBeNull();
  });

  it("never puts money in a tracker", () => {
    for (const status of JOB_STATUSES) {
      for (const audience of ["customer", "tradie"] as const) {
        const text = JSON.stringify(jobTracker(status, audience, { extraWork: true, payout: "QUEUED" }));
        expect(text, `${status} ${audience}`).not.toMatch(/\$|\d+\.\d\d/);
      }
    }
  });

  it("keeps the current step inside the steps", () => {
    for (const status of JOB_STATUSES) {
      for (const audience of ["customer", "tradie"] as const) {
        const model = jobTracker(status, audience);
        if (!model) continue;
        expect(model.current).toBeGreaterThanOrEqual(0);
        expect(model.current).toBeLessThanOrEqual(model.steps.length);
      }
    }
  });
});
