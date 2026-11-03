import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Viewer } from "@/server/auth/viewer";
import type { BrowserPushStatus } from "@/lib/browser-push";

export const PUSH_DEVICE_COOKIE = "tm-push-device";
const proofSchema = z.string().regex(/^[a-f0-9]{64}$/);
const tokenSchema = z.string().min(10).max(4096).regex(/^[\w:.-]+$/);
export const pushHash = (value: string) => createHash("sha256").update(value).digest("hex");
export const validDeviceProof = (value: unknown): value is string => proofSchema.safeParse(value).success;

export async function registerBrowserPush(db: PrismaClient, viewer: Viewer, proof: string, token: unknown, now = new Date()) {
  const parsed = tokenSchema.safeParse(token);
  if (!validDeviceProof(proof) || !parsed.success || viewer.role !== "CUSTOMER") return { status: "refused" } as const;
  const deviceHash = pushHash(proof), tokenHash = pushHash(parsed.data);
  return db.$transaction(async tx => {
    // Deterministic order prevents competing device/token claims from deadlocking.
    for (const key of [`push-device:${deviceHash}`, `push-token:${tokenHash}`].sort()) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
    const profile = await tx.profile.findUnique({ where: { id: viewer.userId }, select: { role: true, emailVerifiedAt: true } });
    if (profile?.role !== "CUSTOMER" || !profile.emailVerifiedAt) return { status: "refused" } as const;
    const elsewhere = await tx.browserPushRegistration.findUnique({ where: { tokenHash } });
    if (elsewhere && elsewhere.deviceHash !== deviceHash) return { status: "refused" } as const;
    const previous = await tx.browserPushRegistration.findUnique({ where: { deviceHash } });
    if (previous && previous.userId !== viewer.userId) await tx.priceReadyPushDelivery.updateMany({ where: { registrationId: previous.id, deliveredAt: null }, data: { failedAt: now } });
    await tx.browserPushRegistration.upsert({ where: { deviceHash },
      create: { userId: viewer.userId, deviceHash, tokenHash, token: parsed.data },
      update: { userId: viewer.userId, tokenHash, token: parsed.data, revokedAt: null },
    });
    await tx.notificationPreference.upsert({ where: { userId_event_channel: { userId: viewer.userId, event: "job.priced", channel: "PUSH" } },
      create: { userId: viewer.userId, event: "job.priced", channel: "PUSH", enabled: true }, update: { enabled: true } });
    return { status: "enabled" } as const;
  });
}

/** Logout can revoke only the device proved by its HttpOnly random cookie, never another device. */
export async function revokeBrowserPush(db: PrismaClient, proof: unknown, now = new Date()) {
  if (!validDeviceProof(proof)) return;
  await db.browserPushRegistration.updateMany({ where: { deviceHash: pushHash(proof), revokedAt: null }, data: { revokedAt: now } });
}

export async function hasBrowserPush(db: PrismaClient, viewer: Viewer, proof: unknown) {
  if (!validDeviceProof(proof) || viewer.role !== "CUSTOMER") return false;
  return Boolean(await db.browserPushRegistration.findFirst({ where: { deviceHash: pushHash(proof), userId: viewer.userId, revokedAt: null,
    user: { role: "CUSTOMER", emailVerifiedAt: { not: null }, notificationPreferences: { some: { event: "job.priced", channel: "PUSH", enabled: true } } },
  }, select: { id: true } }));
}

/** Advisory card state only. Never exposes a foreign device owner or changes a preference/registration. */
export async function browserPushStatus(db: PrismaClient, viewer: Viewer, proof: unknown): Promise<BrowserPushStatus> {
  if (viewer.role !== "CUSTOMER") return "unavailable";
  const profile = await db.profile.findUnique({ where: { id: viewer.userId }, select: {
    role: true, emailVerifiedAt: true,
    notificationPreferences: { where: { event: "job.priced", channel: "PUSH" }, select: { enabled: true }, take: 1 },
    pushRegistrations: { where: { deviceHash: validDeviceProof(proof) ? pushHash(proof) : "" }, select: { revokedAt: true }, take: 1 },
  } });
  if (profile?.role !== "CUSTOMER" || !profile.emailVerifiedAt) return "unavailable";
  if (profile.notificationPreferences[0]?.enabled === false) return "opted-out";
  const own = profile.pushRegistrations[0];
  return own ? own.revokedAt ? "revoked" : profile.notificationPreferences[0]?.enabled === true ? "active" : "inactive" : "inactive";
}

/** One durable display claim, even if FCM retries after an accepted response was lost or a popup was dismissed. */
export async function claimPushDisplay(db: PrismaClient, viewer: Viewer, proof: unknown, deliveryId: unknown, now = new Date()) {
  const id = z.uuid().safeParse(deliveryId);
  if (!id.success || !validDeviceProof(proof) || viewer.role !== "CUSTOMER") return null;
  return db.$transaction(async tx => {
    const row = await tx.priceReadyPushDelivery.findFirst({ where: { id: id.data, userId: viewer.userId }, select: { jobId: true, job: { select: { jobNumber: true } } } });
    if (!row) return null;
    const won = await tx.priceReadyPushDelivery.updateMany({ where: {
      id: id.data, userId: viewer.userId, displayedAt: null, failedAt: null,
      registration: { userId: viewer.userId, deviceHash: pushHash(proof), revokedAt: null },
      notification: { userId: viewer.userId, type: "job.priced" },
      job: { customerId: viewer.userId, status: "PRICED" },
      user: { role: "CUSTOMER", emailVerifiedAt: { not: null }, notificationPreferences: { some: { event: "job.priced", channel: "PUSH", enabled: true } } },
    }, data: { displayedAt: now } });
    return won.count ? { title: "Price ready", body: `TM-${row.job.jobNumber}`, href: `/jobs/${row.jobId}`, tag: `trade-price:${id.data}` } : null;
  });
}
