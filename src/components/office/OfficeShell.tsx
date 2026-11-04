import type { ReactNode } from "react";

import { SessionExpiredProvider } from "@/components/auth/SessionExpired";
import { paymentsInTestMode } from "@/server/app-shell";
import { logInAgainAction } from "@/server/auth/actions";
import { requireRole } from "@/server/auth/guard";
import { getOfficeShellViewer } from "@/server/office-shell";

import { OfficeShellView } from "./OfficeShellView";
import type { OfficeCounts } from "./office-links";
import { getOfficeQueueStats } from "@/server/office/queues";
import { DatabaseNotConfiguredError } from "@/server/db";

export async function OfficeShell({ children, counts }: { children: ReactNode; counts?: OfficeCounts }) {
  // Check on the server as well as in the proxy; neither nav nor children render for a different role.
  const actor = await requireRole(["ADMIN"], { next: "/admin" });
  const viewer = await getOfficeShellViewer(actor);
  if (!viewer) return null;
  let currentCounts = counts;
  if (!currentCounts) {
    try { currentCounts = (await getOfficeQueueStats(actor)).counts; }
    catch (error) { if (!(error instanceof DatabaseNotConfiguredError)) console.error("Office counts could not be read."); }
  }
  // A protected action that finds the session gone shows "You've been logged out" over the page (#108).
  return (
    <SessionExpiredProvider logIn={logInAgainAction} email={viewer.email} role={viewer.role}>
      <OfficeShellView viewer={viewer} counts={currentCounts} testMode={paymentsInTestMode()}>{children}</OfficeShellView>
    </SessionExpiredProvider>
  );
}
