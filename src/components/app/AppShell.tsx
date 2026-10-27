// The signed-in app shell for customers and tradies (#84), reading who is signed in on the server. Used by
// src/app/(app)/layout.tsx; the frame itself is <AppShellView> (./AppShellView.tsx). docs/components/app-shell.md.
import { unstable_rethrow } from "next/navigation";
import type { ReactNode } from "react";

import { SessionExpiredProvider } from "@/components/auth/SessionExpired";
import { getShellViewer, paymentsInTestMode } from "@/server/app-shell";
import { logInAgainAction } from "@/server/auth/actions";
import { getViewer, type Viewer } from "@/server/auth/viewer";

import { AppShellView, MAIN_ID } from "./AppShellView";
import styles from "./app.module.css";

export async function AppShell({ children }: { children: ReactNode }) {
  const viewer = await getShellViewer(await readViewer());
  // The proxy keeps signed-out people and the office out of app pages, so this is only a safety net: the page
  // still shows, without the nav, rather than a nav for someone it doesn't belong to.
  if (!viewer) {
    return (
      <main id={MAIN_ID} tabIndex={-1} className={styles.main}>
        {children}
      </main>
    );
  }
  // A protected action that finds the session gone shows "You've been logged out" over the page (#108).
  return (
    <SessionExpiredProvider logIn={logInAgainAction} email={viewer.email} role={viewer.role}>
      <AppShellView viewer={viewer} testMode={paymentsInTestMode()}>
        {children}
      </AppShellView>
    </SessionExpiredProvider>
  );
}

async function readViewer(): Promise<Viewer | null> {
  try {
    return await getViewer();
  } catch (error) {
    unstable_rethrow(error);
    console.error("App shell: couldn't read the signed-in visitor; showing the page without the nav.", error);
    return null;
  }
}
