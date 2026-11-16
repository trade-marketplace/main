// #353: posting or taking a job needs our own email ownership proof, against a real Postgres. Skipped without
// TEST_DATABASE_URL. Supabase is never contacted: an "auto-confirmed" Auth user is a plain object with
// `email_confirmed_at` set, exactly what Auth returns when its Confirm email setting is off.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Role } from "@/generated/prisma/client";
import { ensureProfile } from "@/server/auth/account";
import { prismaProfiles } from "@/server/auth/profiles";
import type { Viewer } from "@/server/auth/viewer";
import { postJob, type PostJobDeps } from "@/server/jobs/post-job";
import { transitionJob, TransitionPreconditionError } from "@/server/jobs/status-machine";
import { bookJobWindow, loadBooking, requestOtherTimes } from "@/server/jobs/worker-booking";
import { claimWorkerJob } from "@/server/jobs/worker-claim-command";
import { submitWorkerEstimate } from "@/server/jobs/worker-estimate";
import { pointBalance } from "@/server/points/ledger";
import { priceJob } from "@/server/pricing/price-job";
import { requestVariation } from "@/server/variations/request";
import { testDatabaseUrl, useTestSchema } from "../support/test-db";

describe.skipIf(!testDatabaseUrl)("email ownership gates job actions (database, #353)", () => {
  const schema = useTestSchema(import.meta.filename);
  const PROVED = new Date("2026-11-01T00:00:00Z");
  const autoConfirmedAt = "2026-10-26T01:00:00Z";

  async function person(role: Role, emailVerifiedAt: Date | null): Promise<Viewer> {
    const userId = randomUUID(), email = `${userId}@example.test`;
    await schema.db.$executeRaw`INSERT INTO auth.users(id, email) VALUES(${userId}::uuid, ${email})`;
    await schema.db.profile.create({ data: { id: userId, email, role, firstName: role === "TRADIE" ? "Jack" : "Sarah", emailVerifiedAt } });
    return { userId, email, role, firstName: "Test", emailVerified: emailVerifiedAt !== null };
  }
  /** A brand-new Auth user that Supabase auto-confirmed, given a profile the way sign-up and log-in do. */
  async function autoConfirmed(role: "CUSTOMER" | "TRADIE"): Promise<Viewer> {
    const userId = randomUUID(), email = `${userId}@example.test`;
    await schema.db.$executeRaw`INSERT INTO auth.users(id, email) VALUES(${userId}::uuid, ${email})`;
    const profile = await ensureProfile(prismaProfiles(() => schema.db), { id: userId, email, email_confirmed_at: autoConfirmedAt, user_metadata: { role, first_name: "Auto" } });
    expect(profile.emailVerifiedAt).toBeNull();
    // The session would say "verified" if anything trusted the provider; the server must not.
    return { userId, email, role, firstName: "Auto", emailVerified: true };
  }
  const prove = (userId: string) => schema.db.profile.update({ where: { id: userId }, data: { emailVerifiedAt: PROVED } });
  const unprove = (userId: string) => schema.db.profile.update({ where: { id: userId }, data: { emailVerifiedAt: null } });

  // ------------------------------------------------------------ posting

  const now = new Date("2026-11-02T13:00:00Z"); // Nov 3 in Auckland.
  const postDeps: PostJobDeps = { now: () => now, photoExists: async () => true, rateLimit: async () => ({ allowed: true }), notifyWorkers: async () => {} };
  function jobInput(key: string) {
    return { postKey: key, description: "Move a sofa upstairs", category: "OTHER", photoPaths: [], addressLine1: "1 Example St", suburb: "Gladstone", city: "Invercargill", locationSource: "SEARCH", point: { lat: -46.4132, lng: 168.3538 }, timeWindows: [{ date: "2026-11-03", timeOfDay: "MORNING" }] };
  }

  it("an unconfirmed customer can't post a job; once confirmed, the same post goes through", async () => {
    const customer = await person("CUSTOMER", null), key = randomUUID();
    // A stale or forged "verified" session flag changes nothing: the profile is re-read in the transaction.
    expect(await postJob(schema.db, { ...customer, emailVerified: true }, jobInput(key), key, postDeps)).toEqual({ status: "email-required" });
    expect(await schema.db.job.count({ where: { customerId: customer.userId } })).toBe(0);
    await prove(customer.userId);
    expect(await postJob(schema.db, customer, jobInput(key), key, postDeps)).toMatchObject({ status: "posted" });
    expect(await schema.db.job.count({ where: { customerId: customer.userId } })).toBe(1);
  });

  it("provider auto-confirm alone doesn't let a customer post", async () => {
    const customer = await autoConfirmed("CUSTOMER"), key = randomUUID();
    expect(await postJob(schema.db, customer, jobInput(key), key, postDeps)).toEqual({ status: "email-required" });
    // Logging in again with the same auto-confirmed Auth user still doesn't confirm the existing profile.
    await ensureProfile(prismaProfiles(() => schema.db), { id: customer.userId, email: customer.email, email_confirmed_at: autoConfirmedAt });
    expect((await schema.db.profile.findUniqueOrThrow({ where: { id: customer.userId } })).emailVerifiedAt).toBeNull();
    expect(await postJob(schema.db, customer, jobInput(key), key, postDeps)).toEqual({ status: "email-required" });
    expect(await schema.db.job.count({ where: { customerId: customer.userId } })).toBe(0);
  });

  // ------------------------------------------------------------ taking a job

  /** An otherwise fully eligible tradie (identity checked, work area, enough points) and a customer's job. */
  async function tradie(worker: Viewer) {
    const office = await person("ADMIN", PROVED);
    await schema.db.workerProfile.create({ data: { userId: worker.userId, identityCheckedAt: PROVED, identityCheckedById: office.userId, baseSuburb: "Invercargill", areaLat: -46.4132, areaLng: 168.3538, areaRadiusKm: 50, available: true } });
    await schema.db.pointEntry.create({ data: { workerId: worker.userId, delta: 2, reason: "OFFICE" } });
    const customer = await person("CUSTOMER", PROVED);
    const job = (status: "REVIEW" | "BOOKABLE" | "ASSIGNED") => schema.db.job.create({ data: { customerId: customer.userId, category: "OTHER", status: "REVIEW", title: "Move a couch", description: "Move the couch upstairs.", addressLine1: "144 Private Street", suburb: "Windsor", city: "Invercargill", lat: -46.4132, lng: 168.3538, approxLat: -46.4117, approxLng: 168.3538, anyTime: true } })
      .then(async created => {
        if (status === "REVIEW") return created;
        await priceJob(schema.db, { jobId: created.id, minutes: 120, materialsCents: 8500, pricedById: office.userId });
        return schema.db.job.update({ where: { id: created.id }, data: { status, workerId: status === "ASSIGNED" ? worker.userId : null } });
      });
    return { job, customer, office };
  }
  const workerViewer = (viewer: Viewer) => ({ userId: viewer.userId, role: "TRADIE" as const });

  it("an unconfirmed tradie can't claim (command and status machine); once confirmed they can", async () => {
    const worker = await person("TRADIE", null), { job } = await tradie(worker), bookable = await job("BOOKABLE");
    expect(await claimWorkerJob(schema.db, workerViewer(worker), bookable.id)).toEqual({ status: "ineligible", failure: "email-required" });
    const machine = transitionJob(schema.db, { audit: async () => {}, notify: async () => {} }, { jobId: bookable.id, transition: "claim", actor: workerViewer(worker) });
    await expect(machine).rejects.toBeInstanceOf(TransitionPreconditionError);
    await expect(machine).rejects.toMatchObject({ failure: "email-required" });
    expect(await schema.db.job.findUniqueOrThrow({ where: { id: bookable.id } })).toMatchObject({ status: "BOOKABLE", workerId: null });
    expect(await pointBalance(schema.db, worker.userId)).toBe(5);
    expect(await schema.db.auditLog.count({ where: { recordId: bookable.id, action: "job.claimed" } })).toBe(0);
    await prove(worker.userId);
    expect((await claimWorkerJob(schema.db, workerViewer(worker), bookable.id)).status).toBe("claimed");
    expect(await schema.db.job.findUniqueOrThrow({ where: { id: bookable.id } })).toMatchObject({ status: "ASSIGNED", workerId: worker.userId });
  });

  it("provider auto-confirm alone doesn't let a tradie claim or quote", async () => {
    const worker = await autoConfirmed("TRADIE"), { job } = await tradie(worker);
    const bookable = await job("BOOKABLE"), review = await job("REVIEW");
    expect(await claimWorkerJob(schema.db, workerViewer(worker), bookable.id)).toEqual({ status: "ineligible", failure: "email-required" });
    expect(await submitWorkerEstimate(schema.db, workerViewer(worker), review.id, { hours: "2", materials: "0", note: "", needsSiteVisit: false })).toEqual({ status: "ineligible", failure: "email-required" });
    expect(await schema.db.estimate.count({ where: { workerId: worker.userId } })).toBe(0);
  });

  it("an unconfirmed tradie can't quote; once confirmed they can", async () => {
    const worker = await person("TRADIE", null), { job } = await tradie(worker), review = await job("REVIEW");
    const estimate = { hours: "2", materials: "15", note: "", needsSiteVisit: false };
    expect(await submitWorkerEstimate(schema.db, workerViewer(worker), review.id, estimate)).toEqual({ status: "ineligible", failure: "email-required" });
    expect(await schema.db.estimate.count({ where: { jobId: review.id } })).toBe(0);
    await prove(worker.userId);
    expect(await submitWorkerEstimate(schema.db, workerViewer(worker), review.id, estimate)).toMatchObject({ status: "saved" });
    expect(await schema.db.estimate.count({ where: { jobId: review.id, workerId: worker.userId } })).toBe(1);
  });

  it("an assigned tradie whose email is no longer confirmed can't book a time or ask for other times; once confirmed they can", async () => {
    // e.g. they changed their email and haven't opened the new link yet, so email_verified_at went back to null.
    const worker = await person("TRADIE", PROVED), { job, customer } = await tradie(worker), assigned = await job("ASSIGNED");
    const at = new Date("2026-11-11T00:00:00Z"), window = { date: "2026-11-12", timeOfDay: "MORNING" as const };
    const { revision } = (await loadBooking(schema.db, worker, assigned.id, at))!;
    await unprove(worker.userId);
    expect(await bookJobWindow(schema.db, worker, assigned.id, window, revision, at)).toEqual({ status: "email-required" });
    expect(await requestOtherTimes(schema.db, worker, assigned.id, at)).toEqual({ status: "email-required" });
    expect(await schema.db.job.findUniqueOrThrow({ where: { id: assigned.id } })).toMatchObject({ bookedDate: null, bookedTime: null });
    expect(await schema.db.notification.count({ where: { userId: customer.userId, type: { in: ["job.window_booked", "job.reschedule_requested"] } } })).toBe(0);
    // A stranger still gets "forbidden", never a hint about whose email isn't confirmed.
    const stranger = await person("TRADIE", null);
    expect(await bookJobWindow(schema.db, stranger, assigned.id, window, revision, at)).toEqual({ status: "forbidden" });
    await prove(worker.userId);
    expect(await bookJobWindow(schema.db, worker, assigned.id, window, revision, at)).toMatchObject({ status: "booked" });
    expect(await requestOtherTimes(schema.db, worker, assigned.id, at)).toEqual({ status: "asked" });
  });

  it("an assigned tradie whose email isn't confirmed can't ask for extra work; once confirmed they can", async () => {
    const worker = await person("TRADIE", null), { job } = await tradie(worker), assigned = await job("ASSIGNED");
    const requestKey = randomUUID(), path = `variations/${assigned.id}/${worker.userId}/${randomUUID().replaceAll("-", "")}.webp`;
    await schema.db.variationPhoto.create({ data: { path, jobId: assigned.id, uploadedById: worker.userId, requestKey, ready: true } });
    const input = { jobId: assigned.id, requestKey, description: "Replace the second cracked switch", hours: 0.5, photoPaths: [path] };
    expect(await requestVariation(schema.db, worker, input)).toEqual({ ok: false, error: "email-required" });
    expect(await schema.db.variation.count({ where: { jobId: assigned.id } })).toBe(0);
    await prove(worker.userId);
    expect(await requestVariation(schema.db, worker, input)).toMatchObject({ ok: true });
    expect(await schema.db.variation.count({ where: { jobId: assigned.id } })).toBe(1);
  });
});
