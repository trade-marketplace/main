import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Viewer } from "@/server/auth/viewer";
import type { FileStore } from "@/server/files/storage";
import type { UploadDb } from "@/server/files/service";
import { testDatabaseUrl, useTestSchema } from "../support/test-db";

const context = vi.hoisted(() => ({ viewer: null as Viewer | null, db: null as unknown as PrismaClient, store: null as unknown as FileStore }));
vi.mock("@/server/auth/viewer", () => ({ getViewer: async () => context.viewer }));
vi.mock("@/server/db", () => ({ getDb: () => context.db }));
vi.mock("@/server/files/service", async original => {
  const real = await original<typeof import("@/server/files/service")>();
  return { ...real, getUploadService: () => real.createUploadService({ db: context.db as unknown as UploadDb, store: context.store }) };
});
import { GET } from "@/app/api/profile/trades/document/route";

describe.skipIf(!testDatabaseUrl)("private licence document navigation", () => {
  const schema = useTestSchema(import.meta.filename);
  async function worker() {
    const id = randomUUID(); await schema.db.$executeRaw`INSERT INTO auth.users (id) VALUES (${id}::uuid)`;
    await schema.db.profile.create({ data: { id, email: `${id}@example.test`, role: "TRADIE", firstName: "Test" } });
    await schema.db.workerProfile.create({ data: { userId: id } });
    return id;
  }
  const request = (query = "trade=ELECTRICAL") => new Request(`https://example.test/api/profile/trades/document?${query}`);
  it("navigates the checked worker to their own five-minute private document, ignoring another posted identity", async () => {
    const owner = await worker(); const other = await worker(); const path = `licences/${owner}/${"b".repeat(32)}.pdf`;
    await schema.db.workerTrade.create({ data: { userId: owner, trade: "ELECTRICAL" } });
    await schema.db.licence.create({ data: { userId: owner, trade: "ELECTRICAL", number: "E 123456", documentPath: path } });
    context.db = schema.db; context.viewer = { userId: owner, role: "TRADIE", firstName: "Test", email: "test@example.test", emailVerified: true };
    context.store = { put: vi.fn(), remove: vi.fn(), signedUrl: vi.fn(async () => "https://files.example.test/private.pdf?token=short-lived") };
    const response = await GET(request(`trade=ELECTRICAL&userId=${other}&path=licences/${other}/foreign.pdf`), undefined);
    expect(response.status).toBe(303); expect(response.headers.get("location")).toBe("https://files.example.test/private.pdf?token=short-lived");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(context.store.signedUrl).toHaveBeenCalledExactlyOnceWith("documents", path, 300);
    context.viewer = { ...context.viewer, userId: other }; expect((await GET(request(), undefined)).status).toBe(404);
    expect(context.store.signedUrl).toHaveBeenCalledTimes(1);
    context.viewer = { ...context.viewer, role: "CUSTOMER" }; expect((await GET(request(), undefined)).status).toBe(403);
    context.viewer = null; expect((await GET(request(), undefined)).status).toBe(401);
  });
  it("does not sign a corrupt foreign-owner path even if a licence row contains one", async () => {
    const owner = await worker(); const other = await worker();
    await schema.db.workerTrade.create({ data: { userId: owner, trade: "ELECTRICAL" } });
    await schema.db.licence.create({ data: { userId: owner, trade: "ELECTRICAL", number: "E 123456", documentPath: `licences/${other}/${"a".repeat(32)}.pdf` } });
    context.db = schema.db; context.viewer = { userId: owner, role: "TRADIE", firstName: "Test", email: "test@example.test", emailVerified: true };
    context.store = { put: vi.fn(), remove: vi.fn(), signedUrl: vi.fn() };
    expect((await GET(request(), undefined)).status).toBe(404); expect(context.store.signedUrl).not.toHaveBeenCalled();
  });
});
