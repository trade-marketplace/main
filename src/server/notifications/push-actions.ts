"use server";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { withRole } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { authCookieOptions, REMEMBER_ME_MAX_AGE } from "@/server/supabase";
import { firebaseWebConfig } from "./push-config";
import { hasBrowserPush, PUSH_DEVICE_COOKIE, registerBrowserPush, validDeviceProof } from "./browser-push";

/** The browser must acknowledge this cookie response before any token is bound to it. */
export const prepareBrowserPushAction = withRole(["CUSTOMER"], async (viewer, expectedOwnerId: string) => {
  if (viewer.userId !== expectedOwnerId || !firebaseWebConfig()) return { status: "unavailable" } as const;
  try {
    const jar = await cookies(); const previous = jar.get(PUSH_DEVICE_COOKIE)?.value;
    const proof = validDeviceProof(previous) ? previous : randomBytes(32).toString("hex");
    jar.set(PUSH_DEVICE_COOKIE, proof, { ...authCookieOptions(), maxAge: REMEMBER_ME_MAX_AGE });
    return { status: "ready" } as const;
  } catch { return { status: "error" } as const; }
});

export const registerBrowserPushAction = withRole(["CUSTOMER"], async (viewer, expectedOwnerId: string, token: unknown) => {
  if (viewer.userId !== expectedOwnerId || !firebaseWebConfig()) return { status: "unavailable" } as const;
  try {
    const proof = (await cookies()).get(PUSH_DEVICE_COOKIE)?.value;
    if (!validDeviceProof(proof)) return { status: "unprepared" } as const;
    return await registerBrowserPush(getDb(), viewer, proof, token);
  } catch { return { status: "error" } as const; }
});

export const browserPushReceiverAction = withRole(["CUSTOMER"], async viewer => {
  const config = firebaseWebConfig(); if (!config) return { status: "unavailable" } as const;
  const proof = (await cookies()).get(PUSH_DEVICE_COOKIE)?.value;
  if (!await hasBrowserPush(getDb(), viewer, proof)) return { status: "disabled" } as const;
  return { status: "ready", config, ownerId: viewer.userId } as const;
});
