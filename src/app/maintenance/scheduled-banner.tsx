"use client";

import { useEffect, useState } from "react";
import { MaintenanceBanner } from "./banner";

/** Layouts stay mounted during navigation. An open tab can cross either warning boundary. */
export function ScheduledBanner({ warnAt, from, label, initiallyVisible }: {
  warnAt: number; from: number; label: string; initiallyVisible: boolean;
}) {
  const [visible, setVisible] = useState(initiallyVisible);
  useEffect(() => {
    let timer: number;
    function update() {
      window.clearTimeout(timer);
      const now = Date.now();
      setVisible(now >= warnAt && now < from);
      const next = now < warnAt ? warnAt : from;
      if (next > now) timer = window.setTimeout(update, Math.min(next - now, 2_147_483_647));
    }
    timer = window.setTimeout(update, 0);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, [warnAt, from]);
  return visible ? <MaintenanceBanner label={label} /> : null;
}
