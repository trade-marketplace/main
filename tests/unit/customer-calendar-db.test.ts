import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createGuards } from "@/server/auth/guard";
import type { Viewer } from "@/server/auth/viewer";
import { createCalendarRoute } from "@/server/jobs/customer-calendar";
import { bookJobWindow, loadBooking } from "@/server/jobs/worker-booking";
import { testDatabaseUrl, useTestSchema } from "../support/test-db";

describe.skipIf(!testDatabaseUrl)("calendar download route", () => {
  const schema = useTestSchema(import.meta.filename);
  async function person(role: Viewer["role"]): Promise<Viewer> {
    const userId = randomUUID(), email = `${userId}@example.test`;
    await schema.db.$executeRaw`INSERT INTO auth.users(id) VALUES(${userId}::uuid)`;
    await schema.db.profile.create({ data: { id: userId, email, role, firstName: "Sam", emailVerifiedAt: new Date() } });
    return { userId, email, role, firstName: "Sam", emailVerified: true };
  }
  function get(id: string, viewer: Viewer | null) {
    const route = createCalendarRoute(createGuards(async () => viewer).authorize, () => schema.db);
    return route(new Request(`https://trademarketplace.nz/jobs/${id}/calendar.ics`), { params: Promise.resolve({ id }) });
  }
  it("restricts data to both participants and updates one event when the tradie rebooks", async () => {
    const [customer, worker, otherCustomer, otherWorker, admin] = await Promise.all([
      person("CUSTOMER"), person("TRADIE"), person("CUSTOMER"), person("TRADIE"), person("ADMIN"),
    ]);
    const job = await schema.db.job.create({ data: {
      customerId: customer.userId, workerId: worker.userId, category: "PLUMBING", status: "ASSIGNED", anyTime: true,
      title: "Fix tap", description: "Private note +64210000001", addressLine1: "2 Private Road", suburb: "Windsor",
      city: "Invercargill", priceCents: 20987,
    } });
    expect((await get(job.id, customer)).status).toBe(404);
    expect((await get("invalid", customer)).status).toBe(404);
    const now = new Date("2026-11-23T01:00:00Z");
    async function book(date: string, timeOfDay: "MORNING" | "EVENING") {
      const snapshot = await loadBooking(schema.db, worker, job.id, now);
      expect(await bookJobWindow(schema.db, worker, job.id, { date, timeOfDay }, snapshot!.revision, now)).toMatchObject({ status: "booked" });
    }
    await book("2026-11-24", "MORNING");
    for (const denied of [null, otherCustomer, otherWorker, admin]) {
      const response = await get(job.id, denied);
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("");
    }
    const response = await get(job.id, customer);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(`attachment; filename="TM-${job.jobNumber}.ics"`);
    expect(response.headers.get("content-type")).toMatch(/^text\/calendar/);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const first = await response.text();
    expect(await (await get(job.id, worker)).text()).toBe(first);
    expect(first).toContain("DTSTART:20261123T190000Z");
    expect(first).toContain("SEQUENCE:1\r\n");
    expect(first).not.toMatch(/20987|64210000001/);
    await book("2026-11-25", "EVENING");
    const second = await (await get(job.id, customer)).text();
    expect(second).toContain("DTSTART:20261125T040000Z");
    expect(second).toContain("SEQUENCE:2\r\n");
    expect(second.match(/^UID:.+$/m)?.[0]).toBe(first.match(/^UID:.+$/m)?.[0]);
  });
});
