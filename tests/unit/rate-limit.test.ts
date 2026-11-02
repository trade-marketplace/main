import { describe, expect, it, vi } from "vitest";

import { RATE_LIMITS, tryAgainText, waitText } from "@/lib/rate-limit";
import { check, clientAddress, consume, memoryRateLimitStore, type RateLimitStore } from "@/server/rate-limit";

const T0 = Date.UTC(2026, 10, 2, 10, 0, 0); // on a window boundary for every window length used here

function setup(now = T0) {
  const store = memoryRateLimitStore();
  const clock = { now };
  return { store, clock, deps: { store, now: () => clock.now, secret: "test-secret" } };
}

describe("rate limits (#111)", () => {
  it("allows up to the limit, then says how long until they can try again", async () => {
    const { deps, clock } = setup();
    const { limit, windowSeconds } = RATE_LIMITS.signUp;
    for (let i = 0; i < limit; i++) expect(await consume("signUp", "ip:1.2.3.4", deps)).toEqual({ allowed: true });
    clock.now = T0 + 10 * 60_000;
    expect(await consume("signUp", "ip:1.2.3.4", deps)).toEqual({ allowed: false, retryAfter: windowSeconds - 10 * 60 });
  });

  it("lets them in again when the window is over", async () => {
    const { deps, clock } = setup();
    for (let i = 0; i <= RATE_LIMITS.signUp.limit; i++) await consume("signUp", "ip:1.2.3.4", deps);
    expect((await consume("signUp", "ip:1.2.3.4", deps)).allowed).toBe(false);
    clock.now = T0 + RATE_LIMITS.signUp.windowSeconds * 1_000;
    expect(await consume("signUp", "ip:1.2.3.4", deps)).toEqual({ allowed: true });
  });

  it("counts each person and each limit separately", async () => {
    const { deps } = setup();
    for (let i = 0; i <= RATE_LIMITS.passwordReset.limit; i++) await consume("passwordReset", "ip:1.1.1.1", deps);
    expect((await consume("passwordReset", "ip:1.1.1.1", deps)).allowed).toBe(false);
    expect((await consume("passwordReset", "ip:2.2.2.2", deps)).allowed).toBe(true);
    expect((await consume("signUp", "ip:1.1.1.1", deps)).allowed).toBe(true);
  });

  it("check() reads without counting, so only chosen tries (wrong passwords) use up the limit", async () => {
    const { deps } = setup();
    for (let i = 0; i < 50; i++) expect((await check("logInFailures", "ip:1.1.1.1", deps)).allowed).toBe(true);
    for (let i = 0; i < RATE_LIMITS.logInFailures.limit; i++) await consume("logInFailures", "ip:1.1.1.1", deps);
    expect((await check("logInFailures", "ip:1.1.1.1", deps)).allowed).toBe(false);
    expect((await check("logInFailures", "ip:9.9.9.9", deps)).allowed).toBe(true);
  });

  it("stores only a digest: no address or user id, and a different secret gives a different key", async () => {
    const keys: string[] = [];
    const spy: RateLimitStore = { hit: async (key) => (keys.push(key), 1), count: async () => 0, purge: async () => {} };
    await consume("signUp", "ip:203.0.113.7", { store: spy, secret: "one" });
    await consume("signUp", "ip:203.0.113.7", { store: spy, secret: "two" });
    expect(keys[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(keys[0]).not.toContain("203");
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("deletes finished windows", async () => {
    const { deps, store, clock } = setup();
    await consume("signUp", "ip:1.1.1.1", deps);
    const purge = vi.spyOn(store, "purge");
    clock.now = T0 + 3 * 60 * 60_000;
    await consume("signUp", "ip:1.1.1.1", deps);
    await new Promise((resolve) => setImmediate(resolve));
    expect(purge).toHaveBeenCalled();
    expect(await store.count("anything", new Date(T0))).toBe(0);
  });

  it("never blocks real people when counting breaks", async () => {
    const broken: RateLimitStore = { hit: async () => { throw new Error("db down"); }, count: async () => { throw new Error("db down"); }, purge: async () => {} };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await consume("signUp", "ip:1.1.1.1", { store: broken })).toEqual({ allowed: true });
    expect(await check("logInFailures", "ip:1.1.1.1", { store: broken })).toEqual({ allowed: true });
    expect(log).toHaveBeenCalledWith("Rate limit could not be checked.");
    log.mockRestore();
  });

  it("has a limit for log-in, sign-up, password reset, job posting, uploads and messages", () => {
    for (const name of ["logInFailures", "signUp", "passwordReset", "postJob", "upload", "message"] as const) {
      expect(RATE_LIMITS[name].limit).toBeGreaterThan(0);
    }
  });
});

describe("the wait said to a person", () => {
  it("says when they can try again", () => {
    expect(tryAgainText(1)).toBe("Try again in a minute.");
    expect(tryAgainText(60)).toBe("Try again in a minute.");
    expect(tryAgainText(61)).toBe("Try again in 2 minutes.");
    expect(tryAgainText(5 * 60)).toBe("Try again in 5 minutes.");
    expect(waitText(89 * 60)).toBe("89 minutes");
    expect(waitText(60 * 60)).toBe("60 minutes");
    expect(waitText(100 * 60)).toBe("about 2 hours");
    expect(waitText(Number.NaN)).toBe("a minute");
  });
});

describe("what the forms say", () => {
  const values = { email: "a@b.nz" };
  it("log-in: our own limit says when; Supabase's keeps the general wording; nobody is told they're locked", async () => {
    const { logInMessages } = await import("@/components/auth/login-messages");
    expect(logInMessages({ ok: false, error: "try-later", values, retryAfter: 300 }).banner).toMatchObject({ title: "Too many tries.", text: "Try again in 5 minutes." });
    expect(logInMessages({ ok: false, error: "try-later", values }).banner?.text).toBe("Wait a few minutes, or reset your password.");
    expect(JSON.stringify(logInMessages({ ok: false, error: "try-later", values, retryAfter: 300 }))).not.toMatch(/lock/i);
  });
  it("session-expired dialog says when too", async () => {
    const { logInAgainMessages } = await import("@/components/auth/SessionExpired");
    expect(logInAgainMessages({ ok: false, error: "try-later", values, retryAfter: 61 }).banner?.text).toBe("Try again in 2 minutes.");
  });
});

describe("clientAddress", () => {
  const headers = (values: Record<string, string>) => new Headers(values);
  it("prefers the proxy's own header, then the first forwarded address", () => {
    expect(clientAddress(headers({ "x-vercel-forwarded-for": "1.1.1.1", "x-forwarded-for": "2.2.2.2" }))).toBe("1.1.1.1");
    expect(clientAddress(headers({ "x-forwarded-for": " 3.3.3.3 , 10.0.0.1" }))).toBe("3.3.3.3");
    expect(clientAddress(headers({ "x-real-ip": "4.4.4.4" }))).toBe("4.4.4.4");
  });
  it("answers null without one", () => expect(clientAddress(headers({}))).toBeNull());
});
