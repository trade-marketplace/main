"use client";

import { useEffect, useState } from "react";
import type { MaintenanceWindow } from "@/lib/maintenance";
import { MaintenanceBanner } from "./banner";

/** Keep a mounted layout in step with the schedule, including a tab reopened after its timer was suspended. */
export function ScheduledBanner({ schedule, observedAt }: { schedule: MaintenanceWindow; observedAt: number }) {
  const { warnAt, from, until, label } = schedule;
  const [visible, setVisible] = useState(observedAt >= warnAt && observedAt < from);
  useEffect(() => {
    // Count elapsed time from the server's reading even if the visitor's clock is inaccurate.
    const mountedAt = Date.now();
    const wasDown = observedAt >= from && observedAt < until;
    let timer: number;
    let reloading = false;
    function update() {
      window.clearTimeout(timer);
      if (reloading) return;
      const now = observedAt + (Date.now() - mountedAt);
      const down = now >= from && now < until;
      if (down !== wasDown) {
        // Request the current URL again so the proxy can serve the 503 or restore the original page.
        reloading = true;
        window.location.reload();
        return;
      }
      setVisible(now >= warnAt && now < from);
      const next = [warnAt, from, until].find(boundary => boundary > now);
      if (next !== undefined) timer = window.setTimeout(update, Math.min(next - now, 2_147_483_647));
    }
    timer = window.setTimeout(update, 0);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, [warnAt, from, until, observedAt]);
  return visible ? <MaintenanceBanner label={label} /> : null;
}
