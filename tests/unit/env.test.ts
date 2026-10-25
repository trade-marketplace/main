import { describe, expect, it } from "vitest";

import { EnvError, parseEnv } from "@/server/env";

const pooled = "postgresql://postgres.ref:pw@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true";
const direct = "postgresql://postgres.ref:pw@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres";

describe("parseEnv", () => {
  it("runs with the database off when no database variables are set", () => {
    expect(parseEnv({})).toEqual({ database: { enabled: false } });
  });

  it("treats empty values copied from .env.example as unset", () => {
    expect(parseEnv({ DATABASE_URL: "", DIRECT_URL: "  " })).toEqual({ database: { enabled: false } });
  });

  it("turns the database on when both URLs are set", () => {
    expect(parseEnv({ DATABASE_URL: pooled, DIRECT_URL: direct })).toEqual({
      database: { enabled: true, url: pooled, directUrl: direct },
    });
  });

  it("fails fast, naming the variable, when DIRECT_URL is missing", () => {
    expect(() => parseEnv({ DATABASE_URL: pooled })).toThrow(EnvError);
    expect(() => parseEnv({ DATABASE_URL: pooled })).toThrow(/DIRECT_URL is missing[\s\S]*\.env\.example/);
  });

  it("fails fast, naming the variable, when DATABASE_URL is missing", () => {
    expect(() => parseEnv({ DIRECT_URL: direct })).toThrow(/DATABASE_URL is missing/);
  });

  it("fails fast when a URL isn't a Postgres connection string", () => {
    expect(() => parseEnv({ DATABASE_URL: "file:./dev.db", DIRECT_URL: direct })).toThrow(
      /DATABASE_URL must be a postgres:\/\/ or postgresql:\/\/ connection string/,
    );
  });
});
