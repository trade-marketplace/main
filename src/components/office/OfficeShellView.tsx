import type { ReactNode } from "react";

import { Banner } from "@/components/overlays/Banner";

import { OfficeNav } from "./OfficeNav";
import { EMPTY_OFFICE_COUNTS, type OfficeCounts, type OfficeNavPreview } from "./office-links";
import styles from "./office.module.css";

export type OfficeShellViewer = {
  role: "ADMIN";
  firstName: string;
  lastName: string | null;
  email: string;
};

export type OfficeShellViewProps = {
  viewer: OfficeShellViewer;
  /** Supplied by the caller. The shell never calculates or queries waiting-work totals. */
  counts?: OfficeCounts;
  testMode: boolean;
  children: ReactNode;
  preview?: OfficeNavPreview;
};

/** The same frame in production and in the guarded preview; pages supply their own content and h1. */
export function OfficeShellView({ viewer, counts = EMPTY_OFFICE_COUNTS, testMode, children, preview }: OfficeShellViewProps) {
  return (
    <div data-mode="office" className={styles.shell}>
      <a href="#main" className={styles.skip}>Skip to content</a>
      <div className={styles.frame}>
        <OfficeNav viewer={viewer} counts={counts} preview={preview} />
        {/* The banner sits over the page column, not the sidebar, so the sidebar can stay a full screen tall. */}
        <div className={styles.column}>
          {testMode && (
            <aside aria-label="Payments">
              <Banner tone="test" title="Test mode." className={styles.testBanner} />
            </aside>
          )}
          <main id="main" tabIndex={-1} className={styles.main}>{children}</main>
        </div>
      </div>
    </div>
  );
}
