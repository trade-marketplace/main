// The office shell's server data (#85): the signed-in person's display identity. Queue counts are supplied to
// the view by its caller; this frame does not define queue business rules or query jobs, money or support.
import "server-only";

import { cache } from "react";

import type { OfficeShellViewer } from "@/components/office/OfficeShellView";
import type { Viewer } from "@/server/auth/viewer";
import { DatabaseNotConfiguredError, getDb } from "@/server/db";

export type OfficeShellExtras = { lastName: string | null };

/** A small database boundary: unit tests supply a fake and check the actual queries, without connecting. */
export type OfficeShellDatabase = {
  profile: {
    findUnique: (args: {
      where: { id: string };
      select: { lastName: true };
    }) => Promise<{ lastName: string | null } | null>;
  };
};

export type OfficeShellSources = {
  findExtras: (userId: string) => Promise<OfficeShellExtras | null>;
};

/** One optional identity lookup. Only the last name is selected; no queue reads belong in the shell. */
export async function findOfficeShellExtras(
  userId: string,
  database?: OfficeShellDatabase,
): Promise<OfficeShellExtras | null> {
  const db = database ?? getDb();
  return db.profile.findUnique({ where: { id: userId }, select: { lastName: true } });
}

/**
 * Only an office viewer may cause the identity lookup. The layout also calls requireRole before rendering
 * children. If the optional last name cannot be read, keep the known first name rather than break every admin
 * page. Page-specific data failures remain the page's responsibility.
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
      console.error("Office shell: couldn't read the last name; showing the first name only.", error);
  }
  return {
    role: "ADMIN",
    firstName: viewer.firstName,
    lastName: extras?.lastName ?? null,
    email: viewer.email,
  };
}

export const getOfficeShellViewer = cache((viewer: Viewer | null) =>
  loadOfficeShellViewer(viewer, { findExtras: findOfficeShellExtras }),
);
