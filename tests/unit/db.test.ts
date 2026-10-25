import { describe, expect, it } from "vitest";

import { DatabaseNotConfiguredError, getDb } from "@/server/db";

describe("getDb", () => {
  it("explains how to connect instead of trying to when DATABASE_URL is missing", () => {
    expect(() => getDb({})).toThrow(DatabaseNotConfiguredError);
    expect(() => getDb({ DATABASE_URL: "" })).toThrow(/Copy \.env\.example to \.env\.local/);
  });

  it("creates the client lazily, without connecting", () => {
    const db = getDb({ DATABASE_URL: "postgresql://user:pw@127.0.0.1:1/none" });
    expect(db).toBe(getDb({ DATABASE_URL: "postgresql://user:pw@127.0.0.1:1/none" }));
  });
});
