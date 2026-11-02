import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { DatabaseNotConfiguredError, getDb } from "@/server/db";
import { parseEnv } from "@/server/env";

import { isSchedulerRequest } from "./auth";
import { runScheduledRules, type RunSummary } from "./runner";

// The scheduled-jobs endpoint's logic (#99), kept apart from the route file so tests can drive it. The database timer
// (pg_cron, every minute) calls it with the shared secret as a Bearer token. It is never for browsers: no secret
// configured means "not set up", a wrong or missing token means 401, and only POST does anything. It answers with
// counts only, never job details.

const NO_STORE = { "cache-control": "no-store" } as const;

export type SchedulerHandlerDeps = {
  env?: Record<string, string | undefined>;
  getDb?: () => PrismaClient;
  run?: (db: PrismaClient) => Promise<RunSummary>;
};

export async function handleSchedulerPost(request: Request, deps: SchedulerHandlerDeps = {}): Promise<Response> {
  const { scheduler } = parseEnv(deps.env ?? process.env);
  if (!scheduler.enabled) return Response.json({ error: "The scheduler isn't set up." }, { status: 503, headers: NO_STORE });
  if (!isSchedulerRequest(request.headers.get("authorization"), scheduler.secret)) {
    return Response.json({ error: "Unauthorised." }, { status: 401, headers: { ...NO_STORE, "www-authenticate": "Bearer" } });
  }
  try {
    const summary = await (deps.run ?? runScheduledRules)((deps.getDb ?? getDb)());
    return Response.json(summary, { headers: NO_STORE });
  } catch (error) {
    if (!(error instanceof DatabaseNotConfiguredError)) console.error("Scheduled jobs run failed.", error);
    return Response.json({ error: "The scheduled jobs couldn't run." }, { status: 500, headers: NO_STORE });
  }
}

/** Every method except POST is refused. */
export function refuseOtherMethods(): Response {
  return new Response(null, { status: 405, headers: { ...NO_STORE, allow: "POST" } });
}
