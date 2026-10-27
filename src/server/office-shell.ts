// The office shell's server data (#85): the signed-in person's last name and counts of work waiting for the
// office. Never send profile ids, licence details, payout values or support contents to the navigation.
import "server-only";

import { cache } from "react";

import type { OfficeShellViewer } from "@/components/office/OfficeShellView";
import type { OfficeCounts } from "@/components/office/office-links";
import type { Viewer } from "@/server/auth/viewer";
import { DatabaseNotConfiguredError, getDb } from "@/server/db";

export type OfficeShellExtras = { lastName: string | null; counts: OfficeCounts };

/** A small database boundary: unit tests supply a fake and check the actual queries, without connecting. */
export type OfficeShellDatabase = {
  profile: {
    findUnique: (args: {
      where: { id: string };
      select: { lastName: true };
    }) => Promise<{ lastName: string | null } | null>;
  };
  licence: { count: (args: { where: { status: "PENDING" } }) => Promise<number> };
  payout: { count: (args: { where: { status: "QUEUED" } }) => Promise<number> };
  supportThread: { count: (args: { where: { status: "OPEN" } }) => Promise<number> };
};

export type OfficeShellSources = {
  findExtras: (userId: string) => Promise<OfficeShellExtras | null>;
};

function emptyCounts(): OfficeCounts {
  return { queues: 0, jobs: 0, tradies: 0, customers: 0, payouts: 0, payments: 0, reviews: 0, support: 0, settings: 0 };
}

/**
 * Only waiting work is counted: per-trade licences awaiting a check, queued payroll records, and open support
 * threads. The schema explicitly names these queues. All jobs, customers and settings aren't waiting queues;
 * payments and reviews have no pending office-work state yet, so they show no badge.
 *
 * The aggregate Queues badge awaits the definition requested on #85: the mockup's example badge differs from
 * its queue totals, and the spec doesn't define which jobs/actions count. Do not infer that business rule here.
 */
export async function findOfficeShellExtras(
  userId: string,
  database?: OfficeShellDatabase,
): Promise<OfficeShellExtras | null> {
  const db = database ?? getDb();
  const profile = await db.profile.findUnique({ where: { id: userId }, select: { lastName: true } });
  if (!profile) return null;
  const [tradies, payouts, support] = await Promise.all([
    db.licence.count({ where: { status: "PENDING" } }),
    db.payout.count({ where: { status: "QUEUED" } }),
    db.supportThread.count({ where: { status: "OPEN" } }),
  ]);
  return { lastName: profile.lastName, counts: { ...emptyCounts(), tradies, payouts, support } };
}

/**
 * Only an office viewer may cause queue reads. The layout also calls requireRole before rendering children.
 * If optional shell data cannot be read, keep the person's known first name and omit badges rather than break
 * every admin page. Page-specific data failures remain the page's responsibility.
 */
export async function loadOfficeShellViewer(
  viewer: Viewer | null,
  sources: OfficeShellSources,
): Promise<OfficeShellViewer | null> {
  if (!viewer || viewer.role !== "ADMIN") return null;
  let extras: OfficeShellExtras | null = null;
  try {
    extras = await sources.findExtras(viewer.userId);
  } catch (error) {
    if (!(error instanceof DatabaseNotConfiguredError))
      console.error("Office shell: couldn't read the name and queue counts; showing the first name only.", error);
  }
  return {
    role: "ADMIN",
    firstName: viewer.firstName,
    lastName: extras?.lastName ?? null,
    email: viewer.email,
    counts: extras?.counts ?? emptyCounts(),
  };
}

export const getOfficeShellViewer = cache((viewer: Viewer | null) =>
  loadOfficeShellViewer(viewer, { findExtras: findOfficeShellExtras }),
);
