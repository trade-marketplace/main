import type { ReactNode } from "react";

import { SessionExpiredProvider } from "@/components/auth/SessionExpired";
import { paymentsInTestMode } from "@/server/app-shell";
import { logInAgainAction } from "@/server/auth/actions";
import { requireRole } from "@/server/auth/guard";
import { getOfficeShellViewer } from "@/server/office-shell";

import { OfficeShellView } from "./OfficeShellView";
import type { OfficeCounts } from "./office-links";

export async function OfficeShell({ children, counts }: { children: ReactNode; counts?: OfficeCounts }) {
  // Check on the server as well as in the proxy; neither nav nor children render for a different role.
  const viewer = await getOfficeShellViewer(await requireRole(["ADMIN"], { next: "/admin" }));
  if (!viewer) return null;
  // A protected action that finds the session gone shows "You've been logged out" over the page (#108).
  return (
    <SessionExpiredProvider logIn={logInAgainAction} email={viewer.email} role={viewer.role}>
      <OfficeShellView viewer={viewer} counts={counts} testMode={paymentsInTestMode()}>{children}</OfficeShellView>
    </SessionExpiredProvider>
  );
}
