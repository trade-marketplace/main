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
    profile: { findUnique: vi.fn(async () => ({ lastName: "Larsen", _count: { notifications: 3 } }) as { lastName: string | null; _count: { notifications: number } } | null) },
  } satisfies OfficeShellDatabase;
}

afterEach(() => vi.restoreAllMocks());

describe("office shell database reads", () => {
  it("selects the viewer’s display fields and their own unread count", async () => {
    const db = fakeDatabase();
    expect(await findOfficeShellExtras(office.userId, db)).toEqual({
      lastName: "Larsen", unreadNotifications: 3,
    });
    expect(db.profile.findUnique).toHaveBeenCalledExactlyOnceWith({
      where: { id: office.userId },
      select: { lastName: true, avatarPath: true, _count: { select: { notifications: { where: { readAt: null } } } } },
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
  it("passes only the bounded signed photo link to the office layout", async () => {
    const avatarUrl = vi.fn(async () => "https://photos.example.test/office-signed");
    const viewer = await loadOfficeShellViewer(office, { findExtras: async () => ({ lastName: "Larsen", avatarPath: "private-office-path" }), avatarUrl });
    expect(viewer).toMatchObject({ avatarUrl: "https://photos.example.test/office-signed" });
    expect(viewer).not.toHaveProperty("avatarPath");
    expect(avatarUrl).toHaveBeenCalledExactlyOnceWith(office.userId, "private-office-path");
  });

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
      unreadNotifications: 3,
      email: "office@example.test",
      avatarUrl: null,
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
      unreadNotifications: 0,
      email: "office@example.test",
      avatarUrl: null,
    });
  });

  it("keeps the known identity when the optional last name lookup fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = fakeDatabase();
    db.profile.findUnique.mockRejectedValueOnce(new Error("connection reset"));
    expect(await loadOfficeShellViewer(office, { findExtras: (id) => findOfficeShellExtras(id, db) })).toMatchObject({
      firstName: "Matt",
      lastName: null,
      unreadNotifications: 0,
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
    db.profile.findUnique.mockResolvedValueOnce({ lastName: null, _count: { notifications: 0 } });
    expect(await loadOfficeShellViewer(office, { findExtras: (id) => findOfficeShellExtras(id, db) })).toMatchObject({
      firstName: "Matt",
      lastName: null,
    });
  });
});
