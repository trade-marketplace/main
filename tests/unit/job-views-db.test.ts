import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import type { JobStatus, Role } from "@/generated/prisma/client";
import { approximatePin } from "@/server/geo/approximate";
import { loadJobView, requireJobView } from "@/server/views/jobs";
import { testDatabaseUrl, useTestSchema } from "../support/test-db";

describe.skipIf(!testDatabaseUrl)("role views with real PostgreSQL rows", () => {
  const schema = useTestSchema(import.meta.filename);
  async function person(role: Role) {
    const id = randomUUID();
    await schema.db.$executeRawUnsafe("INSERT INTO auth.users (id) VALUES ($1::uuid)", id);
    await schema.db.profile.create({ data: { id, role, firstName: role, email: `${id}@example.test`, phone: "+64210000001" } });
    return { userId: id, role };
  }
  async function fixture(status: JobStatus = "ASSIGNED") {
    const customer = await person("CUSTOMER"), worker = await person("TRADIE"), office = await person("ADMIN");
    const point = { lat: -46.3985, lng: 168.3695 }, approx = approximatePin(point);
    const claimed = ["ASSIGNED", "SUBMITTED", "COMPLETED", "CANCEL_REVIEW", "CANCELLED"].includes(status);
    const job = await schema.db.job.create({ data: { customerId: customer.userId, workerId: claimed ? worker.userId : null,
      category: "OTHER", title: "Hang a door", description: "The frame is fine.", addressLine1: "1 Example Street",
      suburb: "Windsor", city: "Invercargill", lat: point.lat, lng: point.lng, approxLat: approx.lat, approxLng: approx.lng,
      status, priceCents: ["REVIEW", "QUOTE_BOUNTY"].includes(status) ? null : 12000 } });
    await schema.db.estimate.create({ data: { jobId: job.id, workerId: worker.userId, minutes: 60, note: "Worker-only estimate" } });
    return { customer, worker, office, job, point, approx };
  }

  it.each<JobStatus>(["REVIEW", "QUOTE_BOUNTY", "PRICED", "BOOKABLE", "ASSIGNED", "SUBMITTED", "COMPLETED", "CANCEL_REVIEW", "CANCELLED"])("loads only allowed fields for every role in %s", async status => {
    const { customer, worker, office, job, point, approx } = await fixture(status);
    const customerData = await loadJobView(schema.db, customer, job.id);
    expect(customerData).toMatchObject({ id: job.id, address: { line1: "1 Example Street" }, point });
    expect(JSON.stringify(customerData)).not.toMatch(/estimate|margin|workerGross|holidayPay|earnCents/i);
    const workerData = await loadJobView(schema.db, worker, job.id);
    if (status === "PRICED") expect(workerData).toBeNull();
    else {
      const privateAccess = ["ASSIGNED", "SUBMITTED", "COMPLETED", "CANCEL_REVIEW"].includes(status);
      expect(workerData).toMatchObject({ assignedToYou: privateAccess, point: privateAccess ? point : approx });
      expect(JSON.stringify(workerData)).not.toMatch(/priceCents|margin|gstCents|email/i);
      if (!privateAccess) expect(workerData).toMatchObject({ address: null, customer: null });
    }
    expect(await loadJobView(schema.db, office, job.id)).toMatchObject({ estimates: [{ note: "Worker-only estimate" }], customer: { phone: "+64210000001" } });
  });

  it("revokes access on the next read after reassignment and unassignment, without a cached old projection", async () => {
    const { job, worker, point } = await fixture();
    const replacement = await person("TRADIE");
    expect(await loadJobView(schema.db, worker, job.id)).toMatchObject({ point, customer: { phone: "+64210000001" } });
    await schema.db.job.update({ where: { id: job.id }, data: { workerId: replacement.userId } });
    await expect(requireJobView(schema.db, worker, job.id)).rejects.toMatchObject({ digest: expect.stringContaining("404") });
    expect(await loadJobView(schema.db, replacement, job.id)).toMatchObject({ point, assignedToYou: true });
    await schema.db.job.update({ where: { id: job.id }, data: { status: "BOOKABLE", workerId: null } });
    expect(await loadJobView(schema.db, worker, job.id)).toMatchObject({ assignedToYou: false, address: null, customer: null });
  });

  it("returns the same 404 for a guessed foreign id and a nonexistent id", async () => {
    const { job } = await fixture();
    const foreign = await person("CUSTOMER");
    for (const id of [job.id, randomUUID()]) await expect(requireJobView(schema.db, foreign, id)).rejects.toMatchObject({ digest: expect.stringContaining("404") });
    expect(await loadJobView(schema.db, null, job.id)).toBeNull();
  });
});
