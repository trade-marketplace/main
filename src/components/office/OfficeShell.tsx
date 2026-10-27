import type { ReactNode } from "react";

import { paymentsInTestMode } from "@/server/app-shell";
import { requireRole } from "@/server/auth/guard";
import { getOfficeShellViewer } from "@/server/office-shell";

import { OfficeShellView } from "./OfficeShellView";
import type { OfficeCounts } from "./office-links";

export async function OfficeShell({ children, counts }: { children: ReactNode; counts?: OfficeCounts }) {
  // Check on the server as well as in the proxy; neither nav nor children render for a different role.
  const viewer = await getOfficeShellViewer(await requireRole(["ADMIN"], { next: "/admin" }));
  if (!viewer) return null;
  return <OfficeShellView viewer={viewer} counts={counts} testMode={paymentsInTestMode()}>{children}</OfficeShellView>;
}
