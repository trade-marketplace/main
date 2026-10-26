import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { JobStatus } from "@/generated/prisma/enums";
import { audienceForMode, AUDIENCES, JOB_STATUSES, PILL_KINDS, statusPill } from "@/lib/job-status";

type SitemapRow = { server: string; customer_label: string; tradie_label: string; office_queue: string };
const sitemap = JSON.parse(readFileSync(new URL("../../docs/design/sitemap.json", import.meta.url), "utf8")) as {
  job_statuses: SitemapRow[];
};

describe("job status labels", () => {
  it("covers every status in the schema's JobStatus enum, in its order", () => {
    expect(JOB_STATUSES).toEqual(Object.values(JobStatus));
    expect(JOB_STATUSES).toContain("QUOTE_BOUNTY");
  });

  it("gives every status a label and a known colour for each audience, or hides it", () => {
    for (const status of JOB_STATUSES) {
      for (const audience of AUDIENCES) {
        const pill = statusPill(status, audience);
        if (pill === null) continue;
        expect(pill.label.trim(), `${status} ${audience}`).not.toBe("");
        expect(PILL_KINDS).toContain(pill.kind);
      }
    }
  });

  it("matches the labels in docs/design/sitemap.json job_statuses", () => {
    const seen = new Set<string>();
    for (const row of sitemap.job_statuses) {
      const status = row.server.replace(" (new)", "").replace(" + variation", "") as JobStatus;
      const context = row.server.includes("+ variation") ? { extraWork: true } : {};
      seen.add(status);

      expect(statusPill(status, "customer", context)?.label, row.server).toBe(row.customer_label);
      // Office: the queue name, without the note in brackets ("Unclaimed (alert > 48h)").
      expect(statusPill(status, "office", context)?.label, row.server).toBe(row.office_queue.replace(/\s*\(.*\)$/, ""));

      const tradie = statusPill(status, "tradie", context);
      if (row.tradie_label === "(hidden)") expect(tradie, row.server).toBeNull();
      else if (row.tradie_label === "Quote bounty (gold)") expect(tradie).toEqual({ label: "Quote bounty", kind: "bounty" });
      else if (row.tradie_label === "On now / Message customer") {
        expect(tradie?.label).toBe("Message customer");
        expect(statusPill(status, "tradie", { onNow: true })?.label).toBe("On now");
      } else if (row.tradie_label === "Done · Queued / Paid") {
        expect(statusPill(status, "tradie", { payout: "QUEUED" })?.label).toBe("Done · Queued");
        expect(statusPill(status, "tradie", { payout: "PAID" })?.label).toBe("Done · Paid");
      } else expect(tradie?.label, row.server).toBe(row.tradie_label);
    }
    // Every schema status is in the sitemap, so none was worded from nowhere.
    expect([...seen].sort()).toEqual([...JOB_STATUSES].sort());
  });

  it("colours them as FRONTEND_SPEC §2 says (action = the signature colour)", () => {
    expect(statusPill("REVIEW", "customer")?.kind).toBe("waiting");
    expect(statusPill("PRICED", "customer")?.kind).toBe("action");
    expect(statusPill("BOOKABLE", "customer")?.kind).toBe("good");
    expect(statusPill("COMPLETED", "customer")?.kind).toBe("done");
    expect(statusPill("CANCEL_REVIEW", "customer")?.kind).toBe("alert");
    expect(statusPill("REVIEW", "tradie")?.kind).toBe("action");
    expect(statusPill("ASSIGNED", "tradie", { extraWork: true })?.kind).toBe("waiting");
    expect(statusPill("CANCEL_REVIEW", "office")?.kind).toBe("alert");
  });

  it("makes the tradie's quote bounty gold, and only that", () => {
    const gold = JOB_STATUSES.flatMap((s) => AUDIENCES.map((a) => [s, a, statusPill(s, a)?.kind] as const)).filter(
      ([, , kind]) => kind === "bounty",
    );
    expect(gold).toEqual([["QUOTE_BOUNTY", "tradie", "bounty"]]);
  });

  it("names the customer in the tradie's next move, but ignores a blank name", () => {
    expect(statusPill("ASSIGNED", "tradie", { customerFirstName: "Sarah" })?.label).toBe("Message Sarah");
    expect(statusPill("ASSIGNED", "tradie", { customerFirstName: "  " })?.label).toBe("Message customer");
    expect(statusPill("ASSIGNED", "customer", { customerFirstName: "Sarah" })?.label).toBe("Tradie confirmed");
  });

  it("turns the office's unclaimed pill to an alert after 48 hours", () => {
    expect(statusPill("BOOKABLE", "office", { unclaimedOverdue: true })).toEqual({ label: "Unclaimed", kind: "alert" });
    expect(statusPill("BOOKABLE", "customer", { unclaimedOverdue: true })?.label).toBe("Booked");
  });

  it("treats an exported payout as still queued", () => {
    expect(statusPill("COMPLETED", "tradie", { payout: "EXPORTED" })?.label).toBe("Done · Queued");
  });

  it("only changes ASSIGNED for extra work", () => {
    expect(statusPill("SUBMITTED", "customer", { extraWork: true })?.label).toBe("Please check");
  });

  it("maps each mode to the audience whose screens use it", () => {
    expect(audienceForMode("customer")).toBe("customer");
    expect(audienceForMode("trade")).toBe("tradie");
    expect(audienceForMode("office")).toBe("office");
  });
});
