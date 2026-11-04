import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createGuards } from "@/server/auth/guard";
import type { Viewer } from "@/server/auth/viewer";
import { createCustomerJobRevisionRoute } from "@/server/jobs/customer-revision";

const id = "12200000-0000-4000-8000-000000000001";
const owner: Viewer = { userId: "customer-owner", email: "owner@example.test", firstName: "Owner", role: "CUSTOMER", emailVerified: true };
const request = new Request(`https://site.test/api/jobs/${id}/revision`);
const context = (jobId = id) => ({ params: Promise.resolve({ id: jobId }) });

function setup(viewer: Viewer | null, row: { customerId: string; status: "PRICED"; updatedAt: Date; privateNote: string } | null) {
  const findFirst = vi.fn(async (query: { where: { customerId: string } }) => row?.customerId === query.where.customerId ? row : null);
  const db = vi.fn(() => ({ job: { findFirst } }) as unknown as Pick<PrismaClient, "job">);
  return { findFirst, db, get: createCustomerJobRevisionRoute({ authorize: createGuards(async () => viewer).authorize, db }) };
}

describe("customer job revision endpoint", () => {
  it("authenticates CUSTOMER before reading a job and never caches auth responses", async () => {
    for (const [viewer, status] of [[null, 401], [{ ...owner, role: "TRADIE" }, 403], [{ ...owner, role: "ADMIN" }, 403]] as const) {
      const { get, db } = setup(viewer, null);
      const response = await get(request, context());
      expect(response.status).toBe(status);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(db).not.toHaveBeenCalled();
    }
  });
  it("reads only the owner's revision/status and returns a strict projection", async () => {
    const updatedAt = new Date("2026-11-04T00:00:00.123Z");
    const { get, findFirst } = setup(owner, { customerId: owner.userId, status: "PRICED", updatedAt, privateNote: "never serialized" });
    const response = await get(request, context());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revision: updatedAt.toISOString(), status: "PRICED" });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(findFirst).toHaveBeenCalledExactlyOnceWith({ where: { id, customerId: owner.userId }, select: { updatedAt: true, status: true } });
  });
  it("gives identical 404 responses for foreign, missing and malformed jobs", async () => {
    const foreign = setup(owner, { customerId: "someone-else", status: "PRICED", updatedAt: new Date(), privateNote: "foreign secret" });
    for (const response of [await foreign.get(request, context()), await setup(owner, null).get(request, context()), await foreign.get(request, context("malformed"))]) {
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "not-found" });
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    }
    expect(foreign.findFirst).toHaveBeenCalledTimes(1);
  });
  it("keeps database failures private and recoverable", async () => {
    const { get, findFirst } = setup(owner, null);
    findFirst.mockRejectedValueOnce(new Error("private connection detail"));
    const response = await get(request, context());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "unavailable" });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
