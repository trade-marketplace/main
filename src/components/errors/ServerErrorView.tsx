"use client";
// The 500 page (#109): pages.html w-errors, "500 · something broke". Our fault, and it says so. Try again re-renders
// the page that failed; Contact us goes to the contact page. The reference is the server's error digest, so support
// can find the logged details (Next.js logs the error with the same digest). Errors that happened in the browser
// have no digest, so they show no reference; the details go to the console.
import { useEffect } from "react";

import { Button } from "@/components/Button";
import { ErrorState } from "@/components/feedback/ErrorState";
import { errorReference } from "@/lib/error-ref";

import styles from "./errors.module.css";

export const SERVER_ERROR_TITLE = "Something broke.";

export type ServerErrorViewProps = {
  /** The error Next.js caught. Only its digest is shown (as the reference); the message never is. */
  error?: Error & { digest?: string };
  /** Next.js's reset(): renders the page again. */
  onRetry?: () => void;
  /** Log the error to the browser console (default). Previews with a pretend error turn it off. */
  log?: boolean;
};

export function ServerErrorView({ error, onRetry, log = true }: ServerErrorViewProps) {
  useEffect(() => {
    if (error && log) console.error(error);
  }, [error, log]);
  return (
    <div className={styles.wrap}>
      <div className={styles.serverError}>
        <ErrorState
          size="page"
          icon="build"
          title={SERVER_ERROR_TITLE}
          onRetry={onRetry}
          secondaryAction={
            <Button href="/contact" variant="secondary" size="sm" width="auto">
              Contact us
            </Button>
          }
          reference={errorReference(error?.digest) ?? undefined}
          // Said out loud: a page that breaks after it has loaded swaps to this without a route change, so the
          // h1 alone wouldn't be read (and focus may have been on something that's gone).
          className={styles.serverErrorState}
        />
      </div>
    </div>
  );
}
