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

const noCounts = { queues: 0, jobs: 0, tradies: 0, customers: 0, payouts: 0, payments: 0, reviews: 0, support: 0, settings: 0 };

function fakeDatabase() {
  return {
    profile: { findUnique: vi.fn(async () => ({ lastName: "Larsen" }) as { lastName: string | null } | null) },
    licence: { count: vi.fn(async () => 3) },
    payout: { count: vi.fn(async () => 8) },
    supportThread: { count: vi.fn(async () => 2) },
  } satisfies OfficeShellDatabase;
}

afterEach(() => vi.restoreAllMocks());

describe("office shell database reads", () => {
  it("selects only the person's last name and counts waiting work, never full rows", async () => {
    const db = fakeDatabase();
    expect(await findOfficeShellExtras(office.userId, db)).toEqual({
      lastName: "Larsen",
      counts: { ...noCounts, tradies: 3, payouts: 8, support: 2 },
    });
    expect(db.profile.findUnique).toHaveBeenCalledExactlyOnceWith({
      where: { id: office.userId },
      select: { lastName: true },
    });
    expect(db.licence.count).toHaveBeenCalledExactlyOnceWith({ where: { status: "PENDING" } });
    expect(db.payout.count).toHaveBeenCalledExactlyOnceWith({ where: { status: "QUEUED" } });
    expect(db.supportThread.count).toHaveBeenCalledExactlyOnceWith({ where: { status: "OPEN" } });
  });

  it("does not query queues when the person's profile has disappeared", async () => {
    const db = fakeDatabase();
    db.profile.findUnique.mockResolvedValueOnce(null);
    expect(await findOfficeShellExtras(office.userId, db)).toBeNull();
    expect(db.licence.count).not.toHaveBeenCalled();
    expect(db.payout.count).not.toHaveBeenCalled();
    expect(db.supportThread.count).not.toHaveBeenCalled();
  });

  it("preserves an empty queue as zero and a large count for the view to format", async () => {
    const db = fakeDatabase();
    db.licence.count.mockResolvedValueOnce(0);
    db.payout.count.mockResolvedValueOnce(142);
    db.supportThread.count.mockResolvedValueOnce(0);
    expect(await findOfficeShellExtras(office.userId, db)).toMatchObject({
      counts: { ...noCounts, payouts: 142 },
    });
  });

  it("does not turn an incomplete read into a misleading partial set of counts", async () => {
    const db = fakeDatabase();
    db.payout.count.mockRejectedValueOnce(new Error("connection reset"));
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
      counts: { ...noCounts, tradies: 3, payouts: 8, support: 2 },
    });
    expect(result).not.toHaveProperty("userId");
    expect(result).not.toHaveProperty("emailVerified");
    expect(JSON.stringify(result)).not.toContain(office.userId);
  });

  it("uses the known first name and no counts when the profile extras are absent", async () => {
    expect(await loadOfficeShellViewer(office, { findExtras: async () => null })).toEqual({
      role: "ADMIN",
      firstName: "Matt",
      lastName: null,
      email: "office@example.test",
      counts: noCounts,
    });
  });

  it("keeps the shell usable with no badges when a database read fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = fakeDatabase();
    db.supportThread.count.mockRejectedValueOnce(new Error("connection reset"));
    expect(await loadOfficeShellViewer(office, { findExtras: (id) => findOfficeShellExtras(id, db) })).toMatchObject({
      firstName: "Matt",
      lastName: null,
      counts: noCounts,
    });
    expect(log).toHaveBeenCalledOnce();
  });

  it("does not log on each local preview when the database is unconfigured", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const findExtras = vi.fn().mockRejectedValue(new DatabaseNotConfiguredError());
    expect(await loadOfficeShellViewer(office, { findExtras })).toMatchObject({ counts: noCounts });
    expect(log).not.toHaveBeenCalled();
  });

  it("does not share mutable fallback counts between requests", async () => {
    const first = await loadOfficeShellViewer(office, { findExtras: async () => null });
    const second = await loadOfficeShellViewer(office, { findExtras: async () => null });
    expect(first?.counts).not.toBe(second?.counts);
  });
});
