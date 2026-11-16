// Price expiry (#508): a reminder at 3 days, a free close at 7, a revised price restarts the clock, and paying wins.
// Real Postgres with the real migrations; a fixed clock; a fake Stripe. Skipped without TEST_DATABASE_URL.
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterEach, describe, expect, it } from "vitest";
import type { Role } from "@/generated/prisma/client";
import { transitionJob } from "@/server/jobs/status-machine";
import { postAgain } from "@/server/jobs/post-again";
import type { PaymentIntentsApi } from "@/server/payments/payments";
import { priceJob } from "@/server/pricing/price-job";
import { createPriceExpiryRule, PRICE_EXPIRED_REASON } from "@/server/scheduler/price-expiry";
import { testDatabaseUrl, useTestSchema } from "../support/test-db";

const DAY = 24 * 3_600_000;

describe.skipIf(!testDatabaseUrl)("price expiry (database)", () => {
  const schema = useTestSchema(import.meta.filename), effects = { audit: async () => {}, notify: async () => {} };
  // Each case's priced job must not be due in the next case.
  afterEach(async () => { await schema.db.job.updateMany({ where: { status: "PRICED" }, data: { status: "CANCELLED" } }); });
  async function person(role: Role) {
    const id = randomUUID();
    await schema.db.$executeRaw`INSERT INTO auth.users(id) VALUES(${id}::uuid)`;
    await schema.db.profile.create({ data: { id, role, firstName: "Test", email: `${id}@example.test` } });
    return id;
  }
  function fakeStripe(status = "requires_payment_method") {
    const state = { id: `pi_test_${randomUUID()}`, status, cancelled: 0 };
    const intent = () => ({ id: state.id, status: state.status, client_secret: "secret", livemode: false }) as unknown as Stripe.PaymentIntent;
    const api: PaymentIntentsApi = { create: async () => intent(), retrieve: async () => intent(),
      cancel: async () => { if (state.status === "processing" || state.status === "succeeded") throw new Error("Can't cancel."); state.cancelled++; state.status = "canceled"; return intent(); } };
    return { api, state };
  }
  /** A job whose price went to the customer `ago` ms before the returned `sentAt`. */
  async function priced() {
    const customerId = await person("CUSTOMER"), office = await person("ADMIN");
    const job = await schema.db.job.create({ data: { customerId, category: "OTHER", title: "Hang a door", description: "Hang a new interior door.", addressLine1: "508 Test Street", suburb: "Windsor", city: "Invercargill", lat: -46.4, lng: 168.35, locationSource: "SEARCH", accessNotes: "Side gate." } });
    expect((await priceJob(schema.db, { jobId: job.id, minutes: 60, materialsCents: 0 })).ok).toBe(true);
    await transitionJob(schema.db, effects, { jobId: job.id, transition: "send-price", actor: { role: "ADMIN", userId: office } });
    const history = await schema.db.jobStatusHistory.findFirstOrThrow({ where: { jobId: job.id, toStatus: "PRICED" } });
    const pricing = await schema.db.jobPricing.findUniqueOrThrow({ where: { jobId: job.id } });
    const sentAt = new Date(Math.max(history.createdAt.getTime(), pricing.pricedAt.getTime()));
    return { job, customerId, office, sentAt };
  }
  const run = (now: Date, stripe = fakeStripe()) => createPriceExpiryRule({ intents: () => stripe.api }).run({ db: schema.db, now, limit: 100 });
  const at = (sentAt: Date, days: number) => new Date(sentAt.getTime() + days * DAY + 1);
  const notices = (userId: string, type: string) => schema.db.notification.findMany({ where: { userId, type } });
  const status = async (id: string) => (await schema.db.job.findUniqueOrThrow({ where: { id } })).status;

  it("reminds once at 3 days, not before, and never twice for the same price", async () => {
    const { job, customerId, sentAt } = await priced();
    await run(at(sentAt, 2.9));
    expect(await notices(customerId, "job.price_reminder")).toHaveLength(0);
    await Promise.all([run(at(sentAt, 3)), run(at(sentAt, 3))]);
    await run(at(sentAt, 5));
    expect(await notices(customerId, "job.price_reminder")).toEqual([expect.objectContaining({ payload: { jobId: job.id, jobNumber: job.jobNumber, sentAt: sentAt.toISOString() } })]);
    expect(await status(job.id)).toBe("PRICED");
  });

  it("closes for free at 7 days, says why, and runs twice safely", async () => {
    const { job, customerId, sentAt } = await priced();
    await run(at(sentAt, 6.9));
    expect(await status(job.id)).toBe("PRICED");
    await Promise.all([run(at(sentAt, 7)), run(at(sentAt, 7))]);
    expect(await status(job.id)).toBe("CANCELLED");
    expect(await notices(customerId, "job.price_expired")).toHaveLength(1);
    expect(await schema.db.auditLog.findMany({ where: { recordId: job.id, action: "job.price_expired" } })).toEqual([expect.objectContaining({ reason: PRICE_EXPIRED_REASON })]);
    expect(await schema.db.payment.count({ where: { jobId: job.id, status: "PAID" } })).toBe(0);
  });

  it("cancels a checkout the customer left open before closing", async () => {
    const { job, sentAt } = await priced(), stripe = fakeStripe();
    const payment = await schema.db.payment.create({ data: { jobId: job.id, kind: "JOB", amountCents: job.priceCents ?? 1000, providerPaymentId: stripe.state.id, idempotencyKey: randomUUID() } });
    await run(at(sentAt, 7), stripe);
    expect(stripe.state).toMatchObject({ cancelled: 1, status: "canceled" });
    expect(await schema.db.payment.findUniqueOrThrow({ where: { id: payment.id } })).toMatchObject({ status: "FAILED" });
    expect(await status(job.id)).toBe("CANCELLED");
  });

  it.each(["processing", "succeeded"])("leaves the job when its payment is already %s: paying wins", async state => {
    const { job, sentAt } = await priced(), stripe = fakeStripe(state);
    await schema.db.payment.create({ data: { jobId: job.id, kind: "JOB", amountCents: job.priceCents ?? 1000, providerPaymentId: stripe.state.id, idempotencyKey: randomUUID() } });
    expect(await run(at(sentAt, 7), stripe)).toMatchObject({ due: 1, done: 0, skipped: 1 });
    expect(await status(job.id)).toBe("PRICED");
  });

  it("restarts the 7 days, and allows one new reminder, when the office revises the price", async () => {
    const { job, customerId, sentAt } = await priced();
    await run(at(sentAt, 3));
    // A re-price on day 6.
    const later = at(sentAt, 6);
    await schema.db.jobPricing.update({ where: { jobId: job.id }, data: { pricedAt: later } });
    await run(at(sentAt, 7));
    expect(await status(job.id)).toBe("PRICED");
    await run(at(later, 3));
    expect(await notices(customerId, "job.price_reminder")).toHaveLength(2);
    await run(at(later, 7));
    expect(await status(job.id)).toBe("CANCELLED");
  });

  it("leaves paid, declined and cancelled jobs alone", async () => {
    const { job, sentAt } = await priced();
    await schema.db.job.update({ where: { id: job.id }, data: { status: "CANCELLED" } });
    expect(await run(at(sentAt, 10))).toMatchObject({ due: 0 });
  });

  it("Post again starts a draft with the same words, trade and address, never photos, and asks before replacing one", async () => {
    const { job, customerId, sentAt } = await priced();
    await run(at(sentAt, 7));
    const viewer = { userId: customerId, role: "CUSTOMER" as const, email: "", firstName: "Test", emailVerified: true };
    expect(await postAgain(schema.db, viewer, job.id, false)).toEqual({ status: "ready" });
    const draft = (await schema.db.jobDraft.findUniqueOrThrow({ where: { profileId: customerId } })).data as Record<string, unknown>;
    expect(draft).toMatchObject({ description: job.description, category: "OTHER", addressLine1: "508 Test Street", suburb: "Windsor", city: "Invercargill", locationSource: "SEARCH", point: { lat: -46.4, lng: 168.35 }, accessNotes: "Side gate." });
    expect(draft.photoPaths ?? []).toEqual([]);
    expect(draft.timeWindows ?? []).toEqual([]);
    expect(await postAgain(schema.db, viewer, job.id, false)).toEqual({ status: "draft-exists" });
    expect(await postAgain(schema.db, viewer, job.id, true)).toEqual({ status: "ready" });
    const other = { ...viewer, userId: await person("CUSTOMER") };
    expect(await postAgain(schema.db, other, job.id, true)).toEqual({ status: "forbidden" });
  });

  it("Post again is only for jobs whose price expired", async () => {
    const { job, customerId } = await priced();
    await schema.db.job.update({ where: { id: job.id }, data: { status: "CANCELLED" } });
    const viewer = { userId: customerId, role: "CUSTOMER" as const, email: "", firstName: "Test", emailVerified: true };
    expect(await postAgain(schema.db, viewer, job.id, true)).toEqual({ status: "forbidden" });
  });
});
