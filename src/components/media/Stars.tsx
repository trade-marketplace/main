"use client";
// Star ratings (#81): components.css .tm-stars (signature colour, the off stars grey).
//
//   <StarRating value={4.6} count={32} />      shows 4½ stars, "4.6 (32)"; read as "4.6 out of 5 stars, 32 reviews"
//   <StarInput name="stars" value={v} onChange={setV} />   five radios (WEBAPP_SPEC C15 "Leave a review")
//
// StarInput is a real radio group: arrows change the rating, each star is named "3 stars", and the chosen
// one's words show beside it ("Good"). Hovering shows what a click would give.
import { useId, useState } from "react";

import { Icon } from "@/components/Icon";
import { starLabel, starParts } from "@/lib/media";

import styles from "./media.module.css";

export function StarRating({ value, count, size = "md", className }: { value: number; count?: number; size?: "sm" | "md"; className?: string }) {
  const { full, half, empty } = starParts(value);
  const words = `${starLabel(value)}${typeof count === "number" ? `, ${count} review${count === 1 ? "" : "s"}` : ""}`;
  return (
    <span className={[styles.stars, className].filter(Boolean).join(" ")} data-size={size} role="img" aria-label={words}>
      {Array.from({ length: full }, (_, i) => (
        <Icon key={`f${i}`} name="star" fill decorative className={styles.starOn} />
      ))}
      {half && <Icon name="star_half" fill decorative className={styles.starOn} />}
      {Array.from({ length: empty }, (_, i) => (
        <Icon key={`e${i}`} name="star" fill decorative className={styles.starOff} />
      ))}
      <span className={styles.starValue} aria-hidden="true">
        {Math.round(value * 10) / 10}
        {typeof count === "number" && ` (${count})`}
      </span>
    </span>
  );
}

/** The words beside a chosen rating. */
export const STAR_WORDS = ["Poor", "Not great", "Good", "Great", "Excellent"] as const;

export type StarInputProps = {
  /** The form field name: the chosen number (1–5) is sent with the form. */
  name: string;
  value: number | null;
  onChange: (value: number) => void;
  /** The question, read as the group's name: "How did Jack do?". */
  label?: string;
  error?: string;
  className?: string;
};

export function StarInput({ name, value, onChange, label = "Your rating", error, className }: StarInputProps) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value ?? 0;
  return (
    <fieldset className={[styles.starInput, className].filter(Boolean).join(" ")} aria-describedby={error ? `${id}-error` : undefined}>
      <legend className={styles.starLegend}>{label}</legend>
      <div className={styles.starRow} onMouseLeave={() => setHover(null)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className={styles.starOption} onMouseEnter={() => setHover(n)}>
            <input
              type="radio"
              name={name}
              value={n}
              checked={value === n}
              onChange={() => onChange(n)}
              className={styles.starRadio}
            />
            <Icon name="star" fill decorative className={n <= shown ? styles.starOn : styles.starOff} />
            <span className={styles.visuallyHidden}>{`${n} star${n === 1 ? "" : "s"}, ${STAR_WORDS[n - 1]}`}</span>
          </label>
        ))}
        <span className={styles.starWords} aria-hidden="true">
          {shown ? STAR_WORDS[shown - 1] : ""}
        </span>
      </div>
      {error && (
        <p id={`${id}-error`} className={styles.starError}>
          <Icon name="error" size="sm" decorative />
          {error}
        </p>
      )}
    </fieldset>
  );
}
