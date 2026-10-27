import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { OfficeShell } from "@/components/office/OfficeShell";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const viewport: Viewport = { viewportFit: "cover" };

/** Every /admin page inherits the office frame. Each data read/action still checks its own authorization. */
export default function OfficeLayout({ children }: { children: ReactNode }) {
  return <OfficeShell>{children}</OfficeShell>;
}
