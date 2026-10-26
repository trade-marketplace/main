import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { Prisma } from "@/generated/prisma/client";
import { INVERCARGILL_COVERAGE } from "@/lib/geo/coverage";
import { type JobLocation, listJobsNeedingLocationCheck, resolveJobLocation, saveJobLocation } from "@/server/geo/job-location";

import { testDatabaseUrl, useTestSchema } from "../support/test-db";

// The location columns on jobs and addresses (#97), against a real Postgres.

describe.skipIf(!testDatabaseUrl)("job and address locations in the database", () => {
  const schema = useTestSchema(import.meta.filename);

  async function createPerson() {
    const id = randomUUID();
    await schema.db.$executeRawUnsafe(`INSERT INTO auth.users (id) VALUES ($1::uuid)`, id);
    return schema.db.profile.create({ data: { id, email: `${randomUUID()}@example.nz`, firstName: "Test" } });
  }

  async function createJob(data: Partial<Prisma.JobUncheckedCreateInput> = {}) {
    const customer = await createPerson();
    return schema.db.job.create({
      data: {
        customerId: customer.id,
        category: "OTHER",
        title: "Move a couch",
        description: "Three-seater, upstairs.",
        addressLine1: "12 Dee Street",
        suburb: "Invercargill Central",
        city: "Invercargill",
        ...data,
      },
    });
  }

  function located(source: "SEARCH" | "PIN", point = { lat: -46.4118, lng: 168.3477 }): JobLocation {
    const result = resolveJobLocation({ source, suburb: "Invercargill Central", point }, INVERCARGILL_COVERAGE);
    if (!result.ok) throw new Error("expected an inside location");
    return result.location;
  }

  const typed = (): JobLocation => {
    const result = resolveJobLocation({ source: "TYPED", suburb: "Waikiwi" }, INVERCARGILL_COVERAGE);
    if (!result.ok) throw new Error("expected ok");
    return result.location;
  };

  it("saves a searched location with its approximate pin", async () => {
    const job = await createJob();
    const location = located("SEARCH");
    await saveJobLocation(schema.db, job.id, location);
    const saved = await schema.db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(saved).toMatchObject(location);
    expect(saved.approxLat).not.toBe(saved.lat);
  });

  it("keeps the same approximate pin as the job moves through its statuses", async () => {
    const job = await createJob();
    await saveJobLocation(schema.db, job.id, located("SEARCH"));
    const before = await schema.db.job.findUniqueOrThrow({ where: { id: job.id } });
    await schema.db.job.update({ where: { id: job.id }, data: { status: "PRICED", priceCents: 10000 } });
    await schema.db.job.update({ where: { id: job.id }, data: { title: "Move a couch and a bed" } });
    const after = await schema.db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect([after.approxLat, after.approxLng]).toEqual([before.approxLat, before.approxLng]);
  });

  it("drops the approximate pin when the point moves without a new one, so it never sits near the old address", async () => {
    const job = await createJob();
    await saveJobLocation(schema.db, job.id, located("SEARCH"));
    await schema.db.job.update({ where: { id: job.id }, data: { lat: -46.43, lng: 168.33 } });
    const moved = await schema.db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect([moved.approxLat, moved.approxLng]).toEqual([null, null]);
  });

  it("keeps the new approximate pin when the point and pin move together", async () => {
    const job = await createJob();
    await saveJobLocation(schema.db, job.id, located("SEARCH"));
    const next = located("PIN", { lat: -46.43, lng: 168.33 });
    await saveJobLocation(schema.db, job.id, next);
    const moved = await schema.db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect([moved.approxLat, moved.approxLng]).toEqual([next.approxLat, next.approxLng]);
  });

  it("doesn't count a new approximate pin or the office's check as an edit to the job", async () => {
    const job = await createJob({ lat: -46.4118, lng: 168.3477 });
    await schema.db.job.update({
      where: { id: job.id },
      data: { approxLat: -46.413, approxLng: 168.349, locationSource: "PIN", coverage: "INSIDE", locationNeedsCheck: true },
    });
    await schema.db.job.update({ where: { id: job.id }, data: { locationNeedsCheck: false } });
    expect((await schema.db.job.findUniqueOrThrow({ where: { id: job.id } })).editedAt).toBeNull();
  });

  it("lists the jobs the office has to check, oldest first", async () => {
    const pinned = await createJob();
    await saveJobLocation(schema.db, pinned.id, located("PIN"));
    const typedJob = await createJob();
    await saveJobLocation(schema.db, typedJob.id, typed());
    const searched = await createJob();
    await saveJobLocation(schema.db, searched.id, located("SEARCH"));

    const queue = await listJobsNeedingLocationCheck(schema.db);
    const ids = queue.map((job) => job.id);
    expect(ids).toEqual(expect.arrayContaining([pinned.id, typedJob.id]));
    expect(ids).not.toContain(searched.id);
    expect(ids.indexOf(pinned.id)).toBeLessThan(ids.indexOf(typedJob.id));
    expect(queue.find((job) => job.id === typedJob.id)).toMatchObject({ locationSource: "TYPED", coverage: "CHECK_LATER" });
  });

  describe("refuses locations that don't add up", () => {
    const rejects = (data: Partial<Prisma.JobUncheckedCreateInput>, constraint: string) =>
      expect(createJob(data)).rejects.toThrow(new RegExp(constraint));

    it("a typed-only location with a point, or a searched one without", async () => {
      await rejects({ locationSource: "TYPED", lat: -46.41, lng: 168.35 }, "jobs_location_source_point");
      await rejects({ locationSource: "SEARCH" }, "jobs_location_source_point");
      await rejects({ locationSource: "PIN" }, "jobs_location_source_point");
    });

    it("'check later' without the office flag", async () => {
      await rejects({ coverage: "CHECK_LATER", locationNeedsCheck: false }, "jobs_check_later_flagged");
    });

    it("an approximate pin without a real point, half a pin, or the real point itself", async () => {
      await rejects({ approxLat: -46.41, approxLng: 168.35 }, "jobs_approx_needs_point");
      await rejects({ lat: -46.41, lng: 168.35, approxLat: -46.412 }, "jobs_approx_point");
      await rejects({ lat: -46.41, lng: 168.35, approxLat: -46.41, approxLng: 168.35 }, "jobs_approx_not_exact");
      await rejects({ lat: -46.41, lng: 168.35, approxLat: -146.41, approxLng: 168.35 }, "jobs_approx_lat_range");
    });

    it("an address typed-only with a point, or picked from search without one", async () => {
      const person = await createPerson();
      const address = (data: Partial<Prisma.AddressUncheckedCreateInput>) =>
        schema.db.address.create({
          data: { userId: person.id, line1: "12 Dee Street", suburb: "Invercargill Central", city: "Invercargill", ...data },
        });
      await expect(address({ locationSource: "TYPED", lat: -46.41, lng: 168.35 })).rejects.toThrow(
        /addresses_location_source_point/,
      );
      await expect(address({ locationSource: "SEARCH" })).rejects.toThrow(/addresses_location_source_point/);
      await expect(address({ locationSource: "PIN", lat: -46.41, lng: 168.35 })).resolves.toMatchObject({ locationSource: "PIN" });
      await expect(address({ locationSource: "TYPED" })).resolves.toMatchObject({ lat: null });
      // Saved before #97: no source, either way.
      await expect(address({ lat: -46.41, lng: 168.35 })).resolves.toMatchObject({ locationSource: null });
    });
  });
});
