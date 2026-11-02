import "server-only";

import { createHmac, randomBytes } from "node:crypto";
import { headers } from "next/headers";

import type { PrismaClient } from "@/generated/prisma/client";
import { RATE_LIMITS, type RateLimitName } from "@/lib/rate-limit";
import { getDb } from "@/server/db";

// Rate limits (#111). Fixed windows counted in the database so every server instance shares them.
//
// Privacy: the stored key is an HMAC of "limit name + subject", never the IP address or user id itself, and a
// row is deleted as soon as its window is over. Nothing here identifies a person after that.
// Failing open: if counting breaks, people are let through (and it's logged without details) rather than blocked.

export type RateLimitDecision = { allowed: true } | { allowed: false; retryAfter: number };

export type RateLimitStore = {
  /** Adds one to the bucket and answers the new count. */
  hit(key: string, windowStart: Date, expiresAt: Date): Promise<number>;
  count(key: string, windowStart: Date): Promise<number>;
  purge(before: Date): Promise<void>;
};

export type RateLimitDeps = { store?: RateLimitStore; now?: () => number; secret?: string };

export function prismaRateLimitStore(db: Pick<PrismaClient, "$queryRaw" | "$executeRaw">): RateLimitStore {
  return {
    async hit(key, windowStart, expiresAt) {
      const rows = await db.$queryRaw<{ count: number }[]>`
        INSERT INTO "rate_limit_buckets" ("key", "window_start", "count", "expires_at")
        VALUES (${key}, ${windowStart}, 1, ${expiresAt})
        ON CONFLICT ("key", "window_start") DO UPDATE SET "count" = "rate_limit_buckets"."count" + 1
        RETURNING "count"`;
      return Number(rows[0]?.count ?? 1);
    },
    async count(key, windowStart) {
      const rows = await db.$queryRaw<{ count: number }[]>`
        SELECT "count" FROM "rate_limit_buckets" WHERE "key" = ${key} AND "window_start" = ${windowStart}`;
      return Number(rows[0]?.count ?? 0);
    },
    async purge(before) {
      await db.$executeRaw`DELETE FROM "rate_limit_buckets" WHERE "expires_at" < ${before}`;
    },
  };
}

/** Counts in this server's memory: for local work without a database, and as tests' stand-in. */
export function memoryRateLimitStore(): RateLimitStore {
  const buckets = new Map<string, { count: number; expiresAt: number }>();
  const id = (key: string, windowStart: Date) => `${key}@${windowStart.getTime()}`;
  return {
    async hit(key, windowStart, expiresAt) {
      const bucket = buckets.get(id(key, windowStart)) ?? { count: 0, expiresAt: expiresAt.getTime() };
      bucket.count += 1;
      buckets.set(id(key, windowStart), bucket);
      return bucket.count;
    },
    async count(key, windowStart) {
      return buckets.get(id(key, windowStart))?.count ?? 0;
    },
    async purge(before) {
      for (const [bucketId, bucket] of buckets) if (bucket.expiresAt < before.getTime()) buckets.delete(bucketId);
    },
  };
}

let defaultStore: RateLimitStore | undefined;
function store(): RateLimitStore {
  defaultStore ??= process.env.DATABASE_URL?.trim() ? prismaRateLimitStore(getDb()) : memoryRateLimitStore();
  return defaultStore;
}

// Without RATE_LIMIT_SECRET each server instance picks its own, so keys differ between instances (limits are looser,
// never stricter). Set it in Vercel so every instance counts together.
const fallbackSecret = randomBytes(32).toString("hex");

function keyFor(name: RateLimitName, subject: string, secret?: string): string {
  return createHmac("sha256", secret ?? (process.env.RATE_LIMIT_SECRET?.trim() || fallbackSecret)).update(`${name}\n${subject}`).digest("hex");
}

function windowFor(name: RateLimitName, nowMs: number) {
  const size = RATE_LIMITS[name].windowSeconds * 1_000;
  const start = Math.floor(nowMs / size) * size;
  return { start: new Date(start), end: new Date(start + size), retryAfter: Math.max(1, Math.ceil((start + size - nowMs) / 1_000)) };
}

let lastPurge = 0;
async function maybePurge(s: RateLimitStore, nowMs: number) {
  if (nowMs - lastPurge < 5 * 60_000) return;
  lastPurge = nowMs;
  await s.purge(new Date(nowMs));
}

/** Counts one try and says whether it's allowed. */
export async function consume(name: RateLimitName, subject: string, deps: RateLimitDeps = {}): Promise<RateLimitDecision> {
  try {
    const s = deps.store ?? store();
    const nowMs = (deps.now ?? Date.now)();
    const w = windowFor(name, nowMs);
    const count = await s.hit(keyFor(name, subject, deps.secret), w.start, w.end);
    void maybePurge(s, nowMs).catch(() => {});
    return count > RATE_LIMITS[name].limit ? { allowed: false, retryAfter: w.retryAfter } : { allowed: true };
  } catch {
    console.error("Rate limit could not be checked.");
    return { allowed: true };
  }
}

/** Says whether the limit is already used up, without counting. Pair with consume() on the tries that should count. */
export async function check(name: RateLimitName, subject: string, deps: RateLimitDeps = {}): Promise<RateLimitDecision> {
  try {
    const nowMs = (deps.now ?? Date.now)();
    const w = windowFor(name, nowMs);
    const count = await (deps.store ?? store()).count(keyFor(name, subject, deps.secret), w.start);
    return count >= RATE_LIMITS[name].limit ? { allowed: false, retryAfter: w.retryAfter } : { allowed: true };
  } catch {
    console.error("Rate limit could not be checked.");
    return { allowed: true };
  }
}

/** The caller's address from the proxy's headers, or null when there isn't one (local development). */
export function clientAddress(h: Pick<Headers, "get">): string | null {
  const value = h.get("x-vercel-forwarded-for") ?? h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0];
  const address = value?.trim();
  return address ? address.slice(0, 64) : null;
}

async function requestSubject(): Promise<string | null> {
  try {
    return clientAddress(await headers());
  } catch {
    return null;
  }
}

/** consume() for the person behind this request, found by connection. Always allowed when there's no address. */
export async function consumeForClient(name: RateLimitName, deps?: RateLimitDeps): Promise<RateLimitDecision> {
  const subject = await requestSubject();
  return subject ? consume(name, `ip:${subject}`, deps) : { allowed: true };
}

export async function checkForClient(name: RateLimitName, deps?: RateLimitDeps): Promise<RateLimitDecision> {
  const subject = await requestSubject();
  return subject ? check(name, `ip:${subject}`, deps) : { allowed: true };
}

/** consume() for a signed-in person (post a job, add a photo, send a message). */
export function consumeForUser(name: RateLimitName, userId: string, deps?: RateLimitDeps): Promise<RateLimitDecision> {
  return consume(name, `user:${userId}`, deps);
}
