import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";

import { SCHEDULER_RULES, type RuleResult, type SchedulerRule } from "./rules";

// The runner (#99): runs every rule once, in order. Called every minute by the database timer through
// /api/scheduler/run. How it fits together: docs/server/scheduler.md.

/** Jobs one rule handles per run. A backlog (e.g. after a day's downtime) drains over the next runs, oldest first. */
export const DEFAULT_LIMIT = 200;

export type RunSummary = { ranAt: string; rules: RuleResult[] };

export type RunOptions = {
  now?: Date;
  limit?: number;
  rules?: readonly SchedulerRule[];
};

/** Runs the rules. A rule that fails as a whole is counted and logged; the rules after it still run. */
export async function runScheduledRules(db: PrismaClient, options: RunOptions = {}): Promise<RunSummary> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? DEFAULT_LIMIT;
  const rules: RuleResult[] = [];
  for (const rule of options.rules ?? SCHEDULER_RULES) {
    try {
      rules.push(await rule.run({ db, now, limit }));
    } catch (error) {
      console.error(`Scheduled rule ${rule.name} failed.`, error instanceof Error ? error.message : error);
      rules.push({ rule: rule.name, due: 0, done: 0, skipped: 0, failed: 1 });
    }
  }
  return { ranAt: now.toISOString(), rules };
}
