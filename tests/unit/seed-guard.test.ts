import { describe, expect, it } from "vitest";

import { checkSeedTarget, PRODUCTION_PROJECT_REF, SeedRefusedError } from "../../prisma/seed/guard.mjs";

const LOCAL = "postgresql://postgres:postgres@localhost:5432/postgres";
const PREVIEW_REF = "abcdefghijklmnopqrst";
const previewDirect = `postgresql://postgres:pw@db.${PREVIEW_REF}.supabase.co:5432/postgres`;
const previewPooled = `postgresql://postgres.${PREVIEW_REF}:pw@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres`;
const productionDirect = `postgresql://postgres:pw@db.${PRODUCTION_PROJECT_REF}.supabase.co:5432/postgres`;
const productionPooled =
  `postgresql://postgres.${PRODUCTION_PROJECT_REF}:pw@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres`;
const PASSWORD = "a-long-demo-password-from-env";

function refusal(env: Record<string, string | undefined>): string {
  try {
    checkSeedTarget(env);
  } catch (error) {
    expect(error).toBeInstanceOf(SeedRefusedError);
    return (error as Error).message;
  }
  throw new Error("expected the seed to be refused");
}

describe("checkSeedTarget", () => {
  it("seeds a local Postgres with ALLOW_SEED=1, inserting auth users directly", () => {
    expect(checkSeedTarget({ ALLOW_SEED: "1", DIRECT_URL: LOCAL, DATABASE_URL: LOCAL })).toEqual({
      url: LOCAL,
      auth: { mode: "plain" },
      password: undefined,
    });
  });

  it("refuses without ALLOW_SEED=1, even on a local database", () => {
    expect(refusal({ DIRECT_URL: LOCAL, DATABASE_URL: LOCAL })).toMatch(/ALLOW_SEED isn't 1/);
    expect(refusal({ ALLOW_SEED: "true", DIRECT_URL: LOCAL })).toMatch(/ALLOW_SEED isn't 1/);
  });

  it("refuses when no database is set", () => {
    expect(refusal({ ALLOW_SEED: "1" })).toMatch(/Neither DIRECT_URL nor DATABASE_URL/);
  });

  it("refuses the production project by its direct host, even with ALLOW_SEED=1 and keys", () => {
    const message = refusal({
      ALLOW_SEED: "1",
      DIRECT_URL: productionDirect,
      DATABASE_URL: productionPooled,
      NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_PROJECT_REF}.supabase.co`,
      SUPABASE_SECRET_KEY: "sb_secret_x",
      SEED_DEMO_PASSWORD: PASSWORD,
    });
    expect(message).toMatch(/DIRECT_URL points at the production Supabase project/);
    expect(message).toMatch(/DATABASE_URL points at the production Supabase project/);
    expect(message).toMatch(/NEXT_PUBLIC_SUPABASE_URL points at the production Supabase project/);
  });

  it("refuses the production project through the shared pooler host (ref only in the user name)", () => {
    expect(refusal({ ALLOW_SEED: "1", DATABASE_URL: productionPooled })).toMatch(/production Supabase project/);
  });

  it("refuses a production database URL even when the Supabase URL is a preview project", () => {
    expect(
      refusal({
        ALLOW_SEED: "1",
        DIRECT_URL: productionDirect,
        NEXT_PUBLIC_SUPABASE_URL: `https://${PREVIEW_REF}.supabase.co`,
        SUPABASE_SECRET_KEY: "sb_secret_x",
        SEED_DEMO_PASSWORD: PASSWORD,
      }),
    ).toMatch(/production/);
  });

  it("refuses a database that is neither local nor named preview/local", () => {
    expect(refusal({ ALLOW_SEED: "1", DIRECT_URL: "postgresql://u:p@db.example.com:5432/trade" })).toMatch(
      /doesn't look local or preview/,
    );
  });

  it("accepts another host when the database name says preview or local", () => {
    const url = "postgresql://u:p@db.example.com:5432/trade_preview_42";
    expect(checkSeedTarget({ ALLOW_SEED: "1", DIRECT_URL: url }).url).toBe(url);
  });

  it("refuses a Supabase database whose project ref can't be read", () => {
    expect(
      refusal({ ALLOW_SEED: "1", DIRECT_URL: "postgresql://postgres:pw@aws-0-ap-southeast-2.pooler.supabase.com/postgres" }),
    ).toMatch(/project ref can't be read/);
  });

  it("refuses a Supabase preview database without the Auth keys, since its users couldn't log in", () => {
    expect(refusal({ ALLOW_SEED: "1", DIRECT_URL: previewDirect, DATABASE_URL: previewPooled })).toMatch(
      /must be made through Supabase Auth/,
    );
  });

  it("seeds a Supabase preview project through the Auth admin API", () => {
    const target = checkSeedTarget({
      ALLOW_SEED: "1",
      DIRECT_URL: previewDirect,
      DATABASE_URL: previewPooled,
      NEXT_PUBLIC_SUPABASE_URL: `https://${PREVIEW_REF}.supabase.co`,
      SUPABASE_SECRET_KEY: "sb_secret_x",
      SEED_DEMO_PASSWORD: PASSWORD,
    });
    expect(target.url).toBe(previewDirect);
    expect(target.auth).toEqual({
      mode: "supabase",
      url: `https://${PREVIEW_REF}.supabase.co`,
      secretKey: "sb_secret_x",
      ref: PREVIEW_REF,
    });
    expect(target.password).toBe(PASSWORD);
  });

  it("accepts the legacy service_role key name too", () => {
    const target = checkSeedTarget({
      ALLOW_SEED: "1",
      DIRECT_URL: previewDirect,
      NEXT_PUBLIC_SUPABASE_URL: `https://${PREVIEW_REF}.supabase.co`,
      SUPABASE_SERVICE_ROLE_KEY: "legacy",
      SEED_DEMO_PASSWORD: PASSWORD,
    });
    expect(target.auth.mode).toBe("supabase");
  });

  it("refuses when the Supabase URL and the database are different projects", () => {
    expect(
      refusal({
        ALLOW_SEED: "1",
        DIRECT_URL: previewDirect,
        NEXT_PUBLIC_SUPABASE_URL: "https://zzzzzzzzzzzzzzzzzzzz.supabase.co",
        SUPABASE_SECRET_KEY: "sb_secret_x",
        SEED_DEMO_PASSWORD: PASSWORD,
      }),
    ).toMatch(/is project zzzzzzzzzzzzzzzzzzzz but the database is/);
  });

  it("refuses Supabase keys pointed at a project while the database is local", () => {
    expect(
      refusal({
        ALLOW_SEED: "1",
        DIRECT_URL: LOCAL,
        NEXT_PUBLIC_SUPABASE_URL: `https://${PREVIEW_REF}.supabase.co`,
        SUPABASE_SECRET_KEY: "sb_secret_x",
        SEED_DEMO_PASSWORD: PASSWORD,
      }),
    ).toMatch(/database isn't that Supabase project/);
  });

  it("allows a local Supabase (supabase start) next to a local database", () => {
    const target = checkSeedTarget({
      ALLOW_SEED: "1",
      DIRECT_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      SUPABASE_SECRET_KEY: "sb_secret_local",
      SEED_DEMO_PASSWORD: PASSWORD,
    });
    expect(target.auth.mode).toBe("supabase");
  });

  it("needs SEED_DEMO_PASSWORD when making real sign-ins, and at least 10 characters", () => {
    const env = {
      ALLOW_SEED: "1",
      DIRECT_URL: previewDirect,
      NEXT_PUBLIC_SUPABASE_URL: `https://${PREVIEW_REF}.supabase.co`,
      SUPABASE_SECRET_KEY: "sb_secret_x",
    };
    expect(refusal(env)).toMatch(/SEED_DEMO_PASSWORD isn't set/);
    expect(refusal({ ...env, SEED_DEMO_PASSWORD: "short" })).toMatch(/shorter than 10/);
  });

  it("lists every problem at once", () => {
    const message = refusal({ DIRECT_URL: productionDirect });
    expect(message).toMatch(/ALLOW_SEED/);
    expect(message).toMatch(/production/);
  });
});
