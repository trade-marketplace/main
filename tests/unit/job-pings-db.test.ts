import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

import type { JobStatus, PrismaClient, Role } from "@/generated/prisma/client";
import { notificationId } from "@/server/notifications/notify";
import { jobPingQuietHours, jobPings } from "@/server/scheduler/job-pings";
import { testDatabaseUrl, useTestSchema } from "../support/test-db";

const HOUR = 3_600_000;
const NOW = new Date("2026-11-13T00:00:00Z"); // Auckland13:00.
const CHECKED = new Date(NOW.getTime() - 48 * HOUR);

describe("job ping quiet hours", () => {
  it.each([
    ["2026-11-12T07:59:59Z", false], ["2026-11-12T08:00:00Z", true],
    ["2026-11-12T17:59:59Z", true], ["2026-11-12T18:00:00Z", false],
    ["2026-07-12T08:59:59Z", false], ["2026-07-12T09:00:00Z", true],
    ["2026-07-12T18:59:59Z", true], ["2026-07-12T19:00:00Z", false],
  ])("uses the Auckland clock at %s", (at, quiet) => expect(jobPingQuietHours(new Date(at))).toBe(quiet));
  it("honours an exhausted physical deadline without querying or advancing the business clock", async () => {
    expect(await jobPings.run({ db: {} as PrismaClient, now: NOW, limit: 100, deadlineAt: new Date(0) }))
      .toEqual({ rule: "job-pings", due: 0, done: 0, skipped: 0, failed: 0 });
  });
});

describe.skipIf(!testDatabaseUrl)("ready-to-claim pings (database)", () => {
  const schema = useTestSchema(import.meta.filename);
  const db = () => schema.db;
  beforeEach(async () => {
    await db().notification.deleteMany();
    await db().job.deleteMany();
    await db().profile.deleteMany();
    await db().settings.update({ where: { id: 1 }, data: { enabledTrades: ["ELECTRICAL", "PLUMBING", "GAS", "CONSTRUCTION", "OTHER"] } });
  });

  async function person(role: Role = "CUSTOMER") {
    const id = randomUUID();
    await db().$executeRaw`INSERT INTO auth.users(id) VALUES(${id}::uuid)`;
    await db().profile.create({ data: { id, email: `${id}@example.test`, role, firstName: "Fixture", emailVerifiedAt: CHECKED } });
    return id;
  }
  async function worker(options: { available?: boolean; paused?: boolean; outside?: boolean } = {}) {
    const office = await person("ADMIN"), id = await person("TRADIE");
    await db().workerProfile.create({ data: {
      userId: id, identityCheckedAt: CHECKED, identityCheckedById: office, available: options.available ?? true,
      pausedAt: options.paused ? CHECKED : null, baseSuburb: "Invercargill", areaRadiusKm: 25,
      areaLat: options.outside ? -36.85 : -46.4132, areaLng: options.outside ? 174.76 : 168.3538,
    } });
    await db().workerTrade.create({ data: { userId: id, trade: "OTHER" } });
    return id;
  }
  async function job(options: { status?: "BOOKABLE" | "QUOTE_BOUNTY"; entered?: Date; electrical?: boolean } = {}) {
    const status = options.status ?? "BOOKABLE";
    const created = await db().job.create({ data: {
      customerId: await person(), category: options.electrical ? "ELECTRICAL" : "OTHER", status,
      title: "Private job title", description: "Private job details.", addressLine1: "1 Example Street", suburb: "Windsor", city: "Invercargill",
      priceCents: status === "BOOKABLE" ? 12_000 : null, anyTime: true,
      lat: -46.4132, lng: 168.3538, approxLat: -46.4112, approxLng: 168.3558,
    } });
    // The real insert trigger writes the initial history. Set that fixture row's age, keeping its actual status.
    await db().jobStatusHistory.updateMany({ where: { jobId: created.id }, data: { createdAt: options.entered ?? new Date(NOW.getTime() - HOUR) } });
    return created;
  }
  const run = (now = NOW, limit = 100) => jobPings.run({ db: db(), now, limit });
  async function oldPings(userId: string, count: number, legacyCount = 0) {
    const rows = Array.from({ length: count }, (_, index) => {
      const jobId = randomUUID();
      return { id: notificationId(`job-ping:BOOKABLE:${jobId}`, userId), userId, type: "job.ready_to_claim", payload: { jobId, jobNumber: index + 1 }, createdAt: new Date(NOW.getTime() - HOUR) };
    });
    for (let index = 0; index < legacyCount; index++) {
      const jobId = randomUUID();
      rows.push({ id: notificationId(`legacy-bounty:${jobId}`, userId), userId, type: "bounty.available", payload: { jobId, jobNumber: index + 100 }, createdAt: new Date(NOW.getTime() - 1_000) });
    }
    await db().notification.createMany({ data: rows });
  }

  it.each(["BOOKABLE", "QUOTE_BOUNTY"] as const)("accepts the plan's exact job-ping:%s mark key", async status => {
    const created = await job({ status });
    await expect(db().scheduledJobMark.create({ data: { rule: `job-ping:${status}`, jobId: created.id, markedAt: NOW } })).resolves.toMatchObject({ rule: `job-ping:${status}`, jobId: created.id });
  });

  it("pings an eligible tradie once, excludes the customer, and keeps only the public identifiers", async () => {
    const userId = await worker(), created = await job();
    expect(await run()).toMatchObject({ due: 1, done: 1, failed: 0 });
    expect(await run()).toMatchObject({ due: 0, done: 0, failed: 0 });
    const rows = await db().notification.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: notificationId(`job-ping:BOOKABLE:${created.id}`, userId), userId, type: "job.ready_to_claim", payload: { jobId: created.id, jobNumber: created.jobNumber } });
    expect(Object.keys(rows[0].payload as object).sort()).toEqual(["jobId", "jobNumber"]);
    expect(rows[0].channelsSent).not.toContain("PUSH");
    expect(rows[0].channelsSent).not.toContain("EMAIL");
    expect(await db().notification.count({ where: { userId: created.customerId } })).toBe(0);
    expect(await db().scheduledJobMark.count({ where: { rule: "job-ping:BOOKABLE", jobId: created.id } })).toBe(1);
  });

  it.each(["unavailable", "paused", "outside", "wrong-trade"])("does not ping an %s tradie", async reason => {
    const userId = await worker({ available: reason !== "unavailable", paused: reason === "paused", outside: reason === "outside" });
    await job({ electrical: reason === "wrong-trade" });
    expect(await run()).toMatchObject({ done: 1, failed: 0 });
    expect(await db().notification.count({ where: { userId } })).toBe(0);
    expect(await db().scheduledJobMark.count()).toBe(1);
  });

  it("sends nothing during quiet hours, including ASAP, then sends from exactly 7am", async () => {
    const night = new Date("2026-11-12T08:00:00Z"), morning = new Date("2026-11-12T18:00:00Z");
    await worker();
    const created = await job({ entered: new Date(night.getTime() - 60_000) });
    await db().job.update({ where: { id: created.id }, data: { asap: true } });
    expect(await run(night)).toEqual({ rule: "job-pings", due: 0, done: 0, skipped: 0, failed: 0 });
    expect(await db().scheduledJobMark.count()).toBe(0);
    expect(await db().notification.count()).toBe(0);
    expect(await run(morning)).toMatchObject({ due: 1, done: 1, failed: 0 });
    expect(await db().notification.count()).toBe(1);
  });

  it("stops the 11th ping in a rolling 24 hours, even behind a page of unrelated legacy bounties", async () => {
    const userId = await worker(); await oldPings(userId, 10, 60); await job();
    expect(await run()).toMatchObject({ done: 1, failed: 0 });
    expect(await db().notification.count({ where: { userId, type: "job.ready_to_claim" } })).toBe(10);
  });
  it("does not count unrelated bounty producers toward this rule's daily cap", async () => {
    const userId = await worker(); await oldPings(userId, 0, 60); await job();
    expect(await run()).toMatchObject({ done: 1, failed: 0 });
    expect(await db().notification.count({ where: { userId, type: "job.ready_to_claim" } })).toBe(1);
  });
  it("serializes the cap when two runs select different jobs with overlapping daily windows", async () => {
    const userId = await worker(); await oldPings(userId, 9);
    await job({ entered: new Date(NOW.getTime() - 23 * HOUR) });
    await job({ entered: new Date(NOW.getTime() + HOUR) });
    const results = await Promise.all([run(NOW), run(new Date(NOW.getTime() + 2 * HOUR))]);
    expect(results.map(result => result.failed)).toEqual([0, 0]);
    expect(await db().scheduledJobMark.count()).toBe(2);
    expect(await db().notification.count({ where: { userId } })).toBe(10);
  });
  it("two simultaneous runs queue the same job only once", async () => {
    await worker(); await job();
    const results = await Promise.all([run(), run()]);
    expect(results.reduce((sum, result) => sum + result.done, 0)).toBe(1);
    expect(results.reduce((sum, result) => sum + result.failed, 0)).toBe(0);
    expect(await db().notification.count()).toBe(1);
    expect(await db().scheduledJobMark.count()).toBe(1);
  });
  it("skips jobs that entered their status more than 24 hours ago", async () => {
    await worker(); await job({ entered: new Date(NOW.getTime() - 24 * HOUR - 1) });
    expect(await run()).toMatchObject({ due: 0, done: 0, failed: 0 });
    expect(await db().notification.count()).toBe(0);
    expect(await db().scheduledJobMark.count()).toBe(0);
  });
  it("uses the latest status entry and processes the oldest due jobs first within its limit", async () => {
    await worker();
    const oldest = await job({ entered: new Date(NOW.getTime() - 3 * HOUR) });
    const middle = await job({ entered: new Date(NOW.getTime() - 2 * HOUR) });
    const newest = await job({ entered: new Date(NOW.getTime() - 25 * HOUR) });
    await db().jobStatusHistory.create({ data: { jobId: newest.id, toStatus: "BOOKABLE", createdAt: new Date(NOW.getTime() - HOUR) } });
    expect(await run(NOW, 2)).toMatchObject({ due: 2, done: 2, failed: 0 });
    const marked = await db().scheduledJobMark.findMany();
    expect(marked.map(row => row.jobId).sort()).toEqual([oldest.id, middle.id].sort());
    expect(await run()).toMatchObject({ due: 1, done: 1, failed: 0 });
  });
  it("uses bounty.available for an eligible actual QUOTE_BOUNTY without changing its status", async () => {
    const userId = await worker(), created = await job({ status: "QUOTE_BOUNTY" });
    expect(await run()).toMatchObject({ due: 1, done: 1, failed: 0 });
    expect(await db().notification.findMany()).toEqual([expect.objectContaining({ userId, type: "bounty.available", payload: { jobId: created.id, jobNumber: created.jobNumber } })]);
    expect((await db().job.findUniqueOrThrow({ where: { id: created.id } })).status).toBe("QUOTE_BOUNTY" satisfies JobStatus);
  });
});
