import { afterEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { SITE_URL } from "@/lib/metadata";
import { tokenColour } from "@/server/brand-colours";
import { createNotificationEmailRule } from "@/server/notifications/email-rule";
import { notificationEmail } from "@/server/notifications/email-templates";

vi.mock("@/server/database-client", () => ({ databaseSchema: () => "public" }));
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
const id = "11000000-0000-4000-8000-000000000001";
const person = "11000000-0000-4000-8000-000000000002";
const job = { to: "customer@example.test", jobId: id, jobNumber: 1005, title: "Sub wiring" };

describe("G05 notification email words and privacy", () => {
  it("renders the exact price-ready subject, heading, body and button with the customer's price", () => {
    const value = notificationEmail("job.priced", { ...job, priceCents: 37200 });
    expect(value.subject).toBe("Your price is ready · Sub wiring · $372.00");
    expect(value.html).toContain(">Your price is ready</h1>");
    expect(value.text).toContain("Fixed price for Sub wiring, incl. GST. Saying no is free.");
    expect(value.html).toContain(">See your price</a>");
    expect(value.html).toContain(`href="${new URL(`/jobs/${id}`, SITE_URL).href}"`);
    expect(value.html).toContain(`bgcolor="${tokenColour("lime")}"`);
    expect(value.html).not.toMatch(/workerGrossCents|holidayPay|onCost|259\.20/);
  });

  it("uses the fresh first name and configurable sign-off hours for please-check", () => {
    const value = notificationEmail("job.submitted", { ...job, firstName: "Jack", autoReleaseHours: 48 });
    expect(value.subject).toBe("Jack’s finished. All good? · Please check within 48 hours");
    expect(value.html).toContain(">Jack’s finished.</h1>");
    expect(value.text).toContain("Have a look and let us know it’s all sorted. If we don’t hear back in 48 hours, we’ll mark it done.");
    expect(value.html).toContain(">Check &amp; rate</a>");
    const changed = notificationEmail("job.submitted", { ...job, firstName: "Mere", autoReleaseHours: 24 });
    expect(changed.subject).toBe("Mere’s finished. All good? · Please check within 24 hours");
    expect(changed.text).not.toContain("48");
    expect(changed.html).not.toMatch(/workerGrossCents|holidayPay|onCost/);
  });

  it("keeps licence-checked words, Amber button and customer prices out of the tradie email", () => {
    const value = notificationEmail("licence.verified", { to: "tradie@example.test", trade: "ELECTRICAL" });
    expect(value.subject).toBe("Your licence is checked · Electrical · you can claim jobs now");
    expect(value.html).toContain(">You’re good to go.</h1>");
    expect(value.text).toContain("We’ve checked your Electrical licence. You can now claim electrical jobs.");
    expect(value.html).toContain(">Find work</a>");
    expect(value.html).toContain(`href="${new URL("/jobs", SITE_URL).href}"`);
    expect(value.html).toContain(`bgcolor="${tokenColour("amber")}"`);
    expect(value.text + value.html).not.toMatch(/\$|372|259|priceCents|workerGrossCents/);
  });

  it("escapes values, prevents subject-line injection and rejects cross-audience fields", () => {
    const value = notificationEmail("job.priced", { ...job, title: '<img onerror="alert(1)"> & \'test\'\r\nBcc: bad@example.test', priceCents: 12345 });
    expect(value.subject).not.toMatch(/[\r\n]/);
    expect(value.html).toContain("&lt;img onerror=&quot;alert(1)&quot;&gt; &amp; &#39;test&#39;");
    expect(value.html).not.toContain('<img onerror="alert(1)">');
    expect(() => notificationEmail("job.priced", { ...job, priceCents: 37200, workerGrossCents: 25920 } as never)).toThrow();
    expect(() => notificationEmail("licence.verified", { to: "tradie@example.test", trade: "ELECTRICAL", priceCents: 37200 } as never)).toThrow();
  });

  it("includes the common footer and plain-text equivalent on all three emails", () => {
    const values = [notificationEmail("job.priced", { ...job, priceCents: 37200 }), notificationEmail("job.submitted", { ...job, firstName: "Jack", autoReleaseHours: 48 }), notificationEmail("licence.verified", { to: "tradie@example.test", trade: "ELECTRICAL" })];
    for (const value of values) {
      expect(value.text).toContain("Trade Marketplace Ltd · Invercargill · Notification settings:");
      expect(value.html).toContain(`href="${new URL("/profile/notifications", SITE_URL).href}"`);
      expect(value.html).toContain(">Notification settings</a>");
      expect(value.html).toContain("prefers-color-scheme:dark");
      expect(value.from).toBe("Trade Marketplace <hello@trademarketplace.nz>");
    }
  });
});

function store() {
  const now = new Date();
  const current = { id, userId: person, type: "job.priced", payload: { jobId: id }, user: { role: "CUSTOMER", email: job.to, emailVerifiedAt: now, notificationPreferences: [] } };
  const source = { id, customerId: person, workerId: null, title: job.title, jobNumber: job.jobNumber, status: "PRICED", category: "ELECTRICAL", suburb: "Windsor", city: "Invercargill", priceCents: 37200, asap: false,
    createdAt: now, updatedAt: now, statusHistory: [], description: "A job", addressLine1: "1 Example Street", addressLine2: null, postcode: null, accessNotes: null,
    anyTime: true, timeWindows: [], bookedDate: null, bookedTime: null, photos: [], photosNeedCheck: false, worker: null, pricing: null };
  const notification = { findMany: vi.fn(async (args: { where: { type: string } }) => args.where.type === "job.priced" ? [{ id }] : []), findUnique: vi.fn(async () => current), updateMany: vi.fn(async () => ({ count: 1 })) };
  const tx = { notification, job: { findUnique: vi.fn(async () => source) } };
  const db = { ...tx, $transaction: vi.fn(async (fn: (value: typeof tx) => unknown) => fn(tx)), $executeRaw: vi.fn(async () => 1) };
  return { db: db as unknown as PrismaClient, notification, execute: db.$executeRaw };
}

describe("notification email time budgets", () => {
  it("does not claim work when fewer than twelve seconds remain", async () => {
    const fake = store(), send = vi.fn(async () => true);
    expect(await createNotificationEmailRule({ mailer: send }).run({ db: fake.db, now: new Date(), limit: 5, deadlineAt: new Date(Date.now() + 1000) })).toMatchObject({ due: 0, done: 0 });
    expect(fake.notification.findMany).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("times out at ten seconds, releases EMAIL for retry and clears its timer", async () => {
    vi.useFakeTimers();
    const fake = store(), send = vi.fn(() => new Promise<boolean>(() => {}));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const pending = createNotificationEmailRule({ mailer: send }).run({ db: fake.db, now: new Date(), limit: 5 });
    await vi.advanceTimersByTimeAsync(10000);
    expect(await pending).toMatchObject({ due: 1, done: 0, failed: 1 });
    expect(fake.execute).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledExactlyOnceWith(expect.any(Object), `${id}:EMAIL`);
    expect(vi.getTimerCount()).toBe(0);
  });
});
