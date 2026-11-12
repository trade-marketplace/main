import { randomUUID } from "node:crypto";

import { beforeAll, describe, expect, it, vi } from "vitest";

import type { PrismaClient, Role } from "@/generated/prisma/client";
import { findShellExtras, loadShellViewer } from "@/server/app-shell";
import { findOfficeShellExtras, loadOfficeShellViewer } from "@/server/office-shell";

import { testDatabaseUrl, useTestSchema } from "../support/test-db";

let database: PrismaClient;
vi.mock("@/server/db", async importOriginal => ({
  ...await importOriginal<typeof import("@/server/db")>(),
  getDb: () => database,
}));

describe.skipIf(!testDatabaseUrl)("shell avatar data in PostgreSQL", () => {
  const schema = useTestSchema(import.meta.filename);
  beforeAll(() => { database = schema.db; });

  async function person(role: Role) {
    const userId = randomUUID();
    const email = `${userId}@example.test`;
    const avatarPath = `avatars/${userId}/${"a".repeat(32)}.webp`;
    await schema.db.$executeRawUnsafe("INSERT INTO auth.users (id) VALUES ($1::uuid)", userId);
    await schema.db.profile.create({ data: { id: userId, email, role, firstName: "Sarah", lastName: "Thompson", avatarPath } });
    return { viewer: { userId, email, role, firstName: "Sarah", emailVerified: true }, avatarPath };
  }

  it.each(["CUSTOMER", "TRADIE"] as const)("loads %s's existing avatar in the shell's profile lookup", async role => {
    const { viewer, avatarPath } = await person(role);
    expect(await findShellExtras(viewer.userId)).toMatchObject({ avatarPath });
    const sign = vi.fn(async () => "https://photos.example.test/signed");
    const result = await loadShellViewer(viewer, { findExtras: findShellExtras, avatarUrl: sign });
    expect(result).toMatchObject({ avatarUrl: "https://photos.example.test/signed", firstName: "Sarah", lastName: "Thompson" });
    expect(result).not.toHaveProperty("avatarPath");
    expect(sign).toHaveBeenCalledExactlyOnceWith(viewer.userId, avatarPath);
  });

  it("passes the office's signed link through its separate shell lookup", async () => {
    const { viewer, avatarPath } = await person("ADMIN");
    expect(await findOfficeShellExtras(viewer.userId)).toMatchObject({ avatarPath });
    const result = await loadOfficeShellViewer(viewer, { findExtras: findOfficeShellExtras, avatarUrl: async () => "https://photos.example.test/office" });
    expect(result).toMatchObject({ avatarUrl: "https://photos.example.test/office" });
    expect(result).not.toHaveProperty("avatarPath");
  });
});
