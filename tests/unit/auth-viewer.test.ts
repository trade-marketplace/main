import { afterEach, describe, expect, it, vi } from "vitest";

import { loadViewer, readUserIdFromCookies, type ProfileRow } from "@/server/auth/viewer";
import { DatabaseNotConfiguredError } from "@/server/db";

afterEach(() => vi.unstubAllEnvs());

const profile: ProfileRow = {
  id: "user-1",
  email: "sam@example.nz",
  role: "TRADIE",
  firstName: "Sam",
  emailVerifiedAt: new Date("2026-10-26T00:00:00Z"),
};

describe("loadViewer", () => {
  it("is null when signed out, without reading the database", async () => {
    const findProfile = vi.fn();
    expect(await loadViewer({ readUserId: async () => null, findProfile })).toBeNull();
    expect(findProfile).not.toHaveBeenCalled();
  });

  it("takes the role from the profile row", async () => {
    const findProfile = vi.fn(async () => profile);
    expect(await loadViewer({ readUserId: async () => "user-1", findProfile })).toEqual({
      userId: "user-1",
      email: "sam@example.nz",
      role: "TRADIE",
      firstName: "Sam",
      emailVerified: true,
    });
    expect(findProfile).toHaveBeenCalledWith("user-1");
  });

  it("treats a signed-in user with no profile as signed out", async () => {
    expect(await loadViewer({ readUserId: async () => "user-1", findProfile: async () => null })).toBeNull();
  });

  it("treats everyone as signed out when the database isn't connected", async () => {
    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    const findProfile = async () => {
      throw new DatabaseNotConfiguredError();
    };
    expect(await loadViewer({ readUserId: async () => "user-1", findProfile })).toBeNull();
  });

  it("lets other database errors through, rather than quietly signing people out", async () => {
    const findProfile = async () => {
      throw new Error("connection reset");
    };
    await expect(loadViewer({ readUserId: async () => "user-1", findProfile })).rejects.toThrow("connection reset");
  });
});

describe("readUserIdFromCookies", () => {
  it("is null, without touching cookies, when Supabase isn't set up", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    // Outside a request, next/headers' cookies() would throw: getting null proves it wasn't called.
    expect(await readUserIdFromCookies()).toBeNull();
  });
});
