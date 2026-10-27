import { afterEach, describe, expect, it, vi } from "vitest";

import type { Viewer } from "@/server/auth/viewer";
import { DatabaseNotConfiguredError } from "@/server/db";
import {
  findOfficeShellExtras,
  loadOfficeShellViewer,
  type OfficeShellDatabase,
} from "@/server/office-shell";

const office: Viewer = {
  userId: "office-user-id",
  role: "ADMIN",
  firstName: "Matt",
  email: "office@example.test",
  emailVerified: true,
};

function fakeDatabase() {
  return {
    profile: { findUnique: vi.fn(async () => ({ lastName: "Larsen" }) as { lastName: string | null } | null) },
  } satisfies OfficeShellDatabase;
}

afterEach(() => vi.restoreAllMocks());

describe("office shell database reads", () => {
  it("selects only the person's last name, never the full profile", async () => {
    const db = fakeDatabase();
    expect(await findOfficeShellExtras(office.userId, db)).toEqual({
      lastName: "Larsen",
    });
    expect(db.profile.findUnique).toHaveBeenCalledExactlyOnceWith({
      where: { id: office.userId },
      select: { lastName: true },
    });
  });

  it("returns no extras when the person's profile has disappeared", async () => {
    const db = fakeDatabase();
    db.profile.findUnique.mockResolvedValueOnce(null);
    expect(await findOfficeShellExtras(office.userId, db)).toBeNull();
  });

  it("never accesses queue models or counts when loading the shell", async () => {
    const db = fakeDatabase();
    const accessed: PropertyKey[] = [];
    const identityOnly = new Proxy(db, {
      get(target, property) {
        accessed.push(property);
        if (property !== "profile") throw new Error(`The shell must not read ${String(property)}`);
        return target.profile;
      },
    });
    await loadOfficeShellViewer(office, { findExtras: (id) => findOfficeShellExtras(id, identityOnly) });
    expect(accessed).toEqual(["profile"]);
  });

  it("passes database failures to the viewer loader's fallback", async () => {
    const db = fakeDatabase();
    db.profile.findUnique.mockRejectedValueOnce(new Error("connection reset"));
    await expect(findOfficeShellExtras(office.userId, db)).rejects.toThrow("connection reset");
  });
});

describe("office shell viewer", () => {
  it.each([null, "CUSTOMER", "TRADIE"] as const)("rejects %s before calling the database source", async (role) => {
    const findExtras = vi.fn();
    expect(await loadOfficeShellViewer(role ? { ...office, role } : null, { findExtras })).toBeNull();
    expect(findExtras).not.toHaveBeenCalled();
  });

  it("returns the shell's display data without profile ids or authorization fields", async () => {
    const db = fakeDatabase();
    const result = await loadOfficeShellViewer(office, { findExtras: (id) => findOfficeShellExtras(id, db) });
    expect(result).toEqual({
      role: "ADMIN",
      firstName: "Matt",
      lastName: "Larsen",
      email: "office@example.test",
    });
    expect(result).not.toHaveProperty("userId");
    expect(result).not.toHaveProperty("emailVerified");
    expect(result).not.toHaveProperty("counts");
    expect(JSON.stringify(result)).not.toContain(office.userId);
  });

  it("uses the known first name when the profile extras are absent", async () => {
    expect(await loadOfficeShellViewer(office, { findExtras: async () => null })).toEqual({
      role: "ADMIN",
      firstName: "Matt",
      lastName: null,
      email: "office@example.test",
    });
  });

  it("keeps the known identity when the optional last name lookup fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = fakeDatabase();
    db.profile.findUnique.mockRejectedValueOnce(new Error("connection reset"));
    expect(await loadOfficeShellViewer(office, { findExtras: (id) => findOfficeShellExtras(id, db) })).toMatchObject({
      firstName: "Matt",
      lastName: null,
      email: "office@example.test",
    });
    expect(log).toHaveBeenCalledOnce();
  });

  it("does not log on each local preview when the database is unconfigured", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const findExtras = vi.fn().mockRejectedValue(new DatabaseNotConfiguredError());
    expect(await loadOfficeShellViewer(office, { findExtras })).toMatchObject({ firstName: "Matt", lastName: null });
    expect(log).not.toHaveBeenCalled();
  });

  it("keeps an absent last name optional", async () => {
    const db = fakeDatabase();
    db.profile.findUnique.mockResolvedValueOnce({ lastName: null });
    expect(await loadOfficeShellViewer(office, { findExtras: (id) => findOfficeShellExtras(id, db) })).toMatchObject({
      firstName: "Matt",
      lastName: null,
    });
  });
});
