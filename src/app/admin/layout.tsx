import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { OfficeShell } from "@/components/office/OfficeShell";
import { privateMetadata } from "@/lib/metadata";

export const metadata: Metadata = privateMetadata;
export const viewport: Viewport = { viewportFit: "cover" };

/** Every /admin page inherits the office frame. Each data read/action still checks its own authorization. */
export default function OfficeLayout({ children }: { children: ReactNode }) {
  return <OfficeShell>{children}</OfficeShell>;
}
