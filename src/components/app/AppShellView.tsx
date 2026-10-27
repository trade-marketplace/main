// The signed-in app's frame for customers and tradies (#84): skip link, the test-mode banner, the computer's top
// nav, <main id="main">, and the phone's bottom bar. How to use it: docs/components/app-shell.md.
//
//   src/app/(app)/layout.tsx  <AppShell>{children}</AppShell>          reads who is signed in on the server
//   <AppShellView viewer={…} testMode>{children}</AppShellView>         the same frame for a viewer you already have
//
// It paints itself in the person's mode (customer green, tradie orange) like <html> does. The office has its own
// shell (#85).
import type { ReactNode } from "react";

import { TextLink } from "@/components/TextLink";
import { Banner } from "@/components/overlays/Banner";
import { modeForRole } from "@/lib/mode";

import { AppHeader, BottomNav, type NavPreview } from "./AppNav";
import type { AppRole, CountKey } from "./app-links";
import styles from "./app.module.css";

export const MAIN_ID = "main";

/** Everything the shell shows about the signed-in person. Built on the server (src/server/app-shell.ts). */
export type ShellViewer = {
  role: AppRole;
  firstName: string;
  lastName: string | null;
  /** Shown only to its owner, in their avatar menu. */
  email: string;
  /** False until they confirm their email: a banner asks them to (#102). Posting and claiming check it too. */
  emailVerified?: boolean;
  counts: Readonly<Record<CountKey, number>>;
};

export type AppShellViewProps = {
  viewer: ShellViewer;
  /** Payments are in test mode: a gold banner over every page says no real money moves. */
  testMode: boolean;
  children: ReactNode;
  /** Dev previews only: which page the nav should treat as current, and where its links go instead. */
  preview?: NavPreview;
};

export function AppShellView({ viewer, testMode, children, preview }: AppShellViewProps) {
  return (
    <div className={styles.shell} data-mode={modeForRole(viewer.role)}>
      <a href={`#${MAIN_ID}`} className={styles.skip}>
        Skip to content
      </a>
      {testMode && (
        <aside aria-label="Payments">
          <Banner tone="test" title="Test mode." className={styles.testBanner}>
            No real money moves.
          </Banner>
        </aside>
      )}
      {viewer.emailVerified === false && (
        <aside aria-label="Your email">
          <Banner
            tone="info"
            title="Confirm your email."
            className={styles.testBanner}
            action={
              <TextLink href="/verify" inline>
                Send the link again
              </TextLink>
            }
          >
            Open the link we emailed you to post or claim jobs.
          </Banner>
        </aside>
      )}
      <AppHeader viewer={viewer} preview={preview} />
      <main id={MAIN_ID} tabIndex={-1} className={styles.main}>
        {children}
      </main>
      <BottomNav viewer={viewer} preview={preview} />
    </div>
  );
}
