"use client";

import { useEffect, useState } from "react";

import styles from "./tokens.module.css";

const FAMILIES = [
  { family: "Trade Display", weight: "900" },
  { family: "Trade UI", weight: "400" },
  { family: "Material Symbols Rounded", weight: "400" },
] as const;

type Status = "checking" | "loaded" | "failed";

/** Shows whether each self-hosted font actually loaded, so a fallback font can't slip through review. */
export function FontStatus() {
  const [status, setStatus] = useState<Record<string, Status>>({});

  useEffect(() => {
    let cancelled = false;
    for (const { family, weight } of FAMILIES) {
      document.fonts
        .load(`${weight} 16px "${family}"`)
        .then((faces) => !cancelled && setStatus((s) => ({ ...s, [family]: faces.length ? "loaded" : "failed" })))
        .catch(() => !cancelled && setStatus((s) => ({ ...s, [family]: "failed" })));
    }
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <ul className={styles.fontStatus} aria-label="Font loading status">
      {FAMILIES.map(({ family }) => {
        const value = status[family] ?? "checking";
        return (
          <li key={family} data-status={value}>
            <span className={styles.fontStatusName}>{family}</span>
            <span className={styles.fontStatusValue}>{value}</span>
          </li>
        );
      })}
    </ul>
  );
}
