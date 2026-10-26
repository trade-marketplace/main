"use client";
// Errors (#79), in the three sizes FRONTEND_SPEC "Offline / error" asks for:
// - <ErrorState size="page">: the whole page failed (500, "Something broke on our end."), centred, with Try again.
// - <ErrorState> (size "section"): one part of a page failed to load ("Can't load your jobs"), with Try again.
// - <InlineError>: a small red banner inside a card or above a form ("Couldn't save that."), with Try again.
// Copy says what happened and what to do; never a raw error code (log it, and show a support reference).
// Each one is said once, politely, when it appears. Try again is a kit <Button>: while `onRetry` is working
// (it returned a promise) the button shows its spinner and can't be pressed twice.
//
//   <ErrorState title="Can't load your jobs" message="Check your connection and try again." onRetry={reload}
//     secondaryAction={<TextLink href="/help">Contact support</TextLink>} />
//   <ErrorState size="page" icon="build" title="Something broke on our end." reference="7F3A-91" onRetry={reset} />
//   <InlineError message="Couldn't save your changes." onRetry={save} />
import { type ReactNode, useEffect, useRef, useState } from "react";

import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";

import type { HeadingLevel } from "./EmptyState";
import { LiveMessage } from "./LiveMessage";
import styles from "./feedback.module.css";

/** Something to call on Try again. If it returns a promise, the button shows its spinner until it settles. */
export type RetryHandler = () => unknown;

/** Runs onRetry; `busy` is true while a returned promise is pending (or while `retrying` says so). */
function useRetry(onRetry: RetryHandler | undefined, retrying: boolean | undefined) {
  const [pending, setPending] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const busy = Boolean(retrying) || pending;
  const run = () => {
    if (!onRetry || busy) return;
    const result = onRetry();
    if (result instanceof Promise) {
      setPending(true);
      // A failed retry is the caller's to show (usually this error again); here it only ends the spinner.
      result.catch(() => {}).finally(() => mounted.current && setPending(false));
    }
  };
  return { busy, run };
}

/** "Can't load your jobs. Check your connection and try again." as one sentence for screen readers. */
export function announcement(title: string, message: ReactNode): string {
  const words = typeof message === "string" ? message.trim() : "";
  const head = title.trim();
  if (!words) return head;
  return /[.!?…]$/.test(head) ? `${head} ${words}` : `${head}. ${words}`;
}

export type ErrorStateProps = {
  /** What happened, in plain words: "Can't load your jobs". */
  title: string;
  /** What to do about it: "Check your connection and try again." */
  message?: ReactNode;
  /** Shows a Try again button. Return a promise to show its spinner while it works. */
  onRetry?: RetryHandler;
  /** Default "Try again". */
  retryLabel?: string;
  /** Set it while a retry you started elsewhere is working. */
  retrying?: boolean;
  /** A second, quieter action: a <TextLink> to support or home. */
  secondaryAction?: ReactNode;
  /** A support reference (never the raw error): shown as "Error ref 7F3A-91 (for support)". */
  reference?: string;
  /** A Material Symbols name. Default "cloud_off" (couldn't load); "build" for "something broke". */
  icon?: string;
  /** page: the whole page failed (taller, h1 by default). section: one part of the page (h2 by default). */
  size?: "page" | "section";
  headingLevel?: HeadingLevel;
  /** Say it to screen readers when it appears. Default true; turn off for an error shown on first page load. */
  announce?: boolean;
  className?: string;
};

export function ErrorState({
  title,
  message,
  onRetry,
  retryLabel = "Try again",
  retrying,
  secondaryAction,
  reference,
  icon = "cloud_off",
  size = "section",
  headingLevel,
  announce = true,
  className,
}: ErrorStateProps) {
  const retry = useRetry(onRetry, retrying);
  const Heading = `h${headingLevel ?? (size === "page" ? 1 : 2)}` as const;
  return (
    <div className={[styles.empty, size === "page" && styles.page, className].filter(Boolean).join(" ")}>
      <span className={`${styles.badge} ${styles.errorBadge}`}>
        <Icon name={icon} decorative />
      </span>
      <Heading className={styles.title}>{title}</Heading>
      {message && <p className={styles.message}>{message}</p>}
      {(onRetry || secondaryAction) && (
        <div className={styles.actions}>
          {onRetry && (
            // The 500 page in pages.html uses small buttons; a section error (screens.html) the default size.
            <Button iconEnd="refresh" size={size === "page" ? "sm" : "md"} loading={retry.busy} onClick={retry.run}>
              {retryLabel}
            </Button>
          )}
          {secondaryAction}
        </div>
      )}
      {reference && <p className={styles.reference}>Error ref {reference} (for support)</p>}
      {announce && <LiveMessage message={announcement(title, message)} />}
    </div>
  );
}

export type InlineErrorProps = {
  /** What happened and what to do: "Couldn't save your changes. Check your connection." Plain text, so it can be
   *  read out as it is. */
  message: string;
  /** Shows a Try again button at the end of the banner. Return a promise to show its spinner. */
  onRetry?: RetryHandler;
  retryLabel?: string;
  retrying?: boolean;
  /** Say it to screen readers when it appears. Default true. */
  announce?: boolean;
  /** For aria-describedby on the field or card it belongs to. */
  id?: string;
  className?: string;
};

export function InlineError({ message, onRetry, retryLabel = "Try again", retrying, announce = true, id, className }: InlineErrorProps) {
  const retry = useRetry(onRetry, retrying);
  return (
    <div id={id} className={[styles.banner, styles.alert, className].filter(Boolean).join(" ")}>
      <span className={styles.bannerText}>
        <Icon name="error" fill decorative />
        <span>{message}</span>
      </span>
      {onRetry && (
        <Button variant="tertiary" loading={retry.busy} onClick={retry.run} className={styles.bannerAction}>
          {retryLabel}
        </Button>
      )}
      {announce && <LiveMessage message={message} />}
    </div>
  );
}
