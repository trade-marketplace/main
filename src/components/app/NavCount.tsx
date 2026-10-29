"use client";

import { useBump } from "@/lib/motion/hooks";

import { countText } from "./app-links";
import styles from "./app.module.css";

/** M20 replays only when the server's unread count increases. */
export function NavCount({ count, className }: { count: number; className?: string }) {
  const bump = useBump(count, (was, now) => now > was);
  const text = countText(count);
  if (!text) return null;
  return <span key={bump} className={[styles.count, bump > 0 && "tm-anim-badge", className].filter(Boolean).join(" ")} aria-hidden="true">{text}</span>;
}
