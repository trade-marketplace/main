"use client";
// A polite screen-reader announcement (#79): "Loading your jobs", "Can't load your jobs", "You're offline".
// Used by the loading, error and offline components; use it yourself for a change that has no visible focus.
//
//   <LiveMessage message={saving ? "Saving" : null} />
//
// It never spams: the same message isn't read twice in a row, a burst of changes reads only the last one, and the
// text is cleared after a few seconds so it isn't read again when someone reads the page line by line.
import { useEffect, useState } from "react";

import styles from "./feedback.module.css";

/**
 * Wait before speaking. The region is in the page before its text arrives, which screen readers need to notice
 * the change, and quick changes (a load that finishes straight away) collapse into one.
 */
export const ANNOUNCE_DELAY_MS = 150;
/** Then clear it, so the message isn't left lying around in the page for screen-reader users to trip over. */
export const ANNOUNCE_CLEAR_MS = 7000;

export type LiveMessageProps = {
  /** What to say. null or "" says nothing (and clears anything still there). */
  message: string | null | undefined;
  /** Extra wait before speaking, e.g. 300ms for loading so fast loads say nothing (M15). */
  delay?: number;
};

export function LiveMessage({ message, delay = 0 }: LiveMessageProps) {
  const [text, setText] = useState("");

  useEffect(() => {
    const say = setTimeout(() => setText(message ?? ""), message ? Math.max(delay, ANNOUNCE_DELAY_MS) : 0);
    const clear = message ? setTimeout(() => setText(""), Math.max(delay, ANNOUNCE_DELAY_MS) + ANNOUNCE_CLEAR_MS) : null;
    return () => {
      clearTimeout(say);
      if (clear) clearTimeout(clear);
    };
  }, [message, delay]);

  // role="status" is a polite live region (aria-live="polite", aria-atomic="true"): it waits for the screen
  // reader to finish what it is saying instead of interrupting.
  return (
    <span role="status" className={styles.visuallyHidden}>
      {text}
    </span>
  );
}
