"use client";
// /dev/components/cards: the parts that need state (Save on a job tile). Everything else is in page.tsx.
// Names, prices, distances and suburbs are examples (AGENTS.md: real values come from the server).
import { useState } from "react";

import { JobTile, type JobTileProps } from "@/components/cards";

type DemoTile = Omit<JobTileProps, "saved" | "onSavedChange"> & { saved?: boolean };

/** A tile whose bookmark really toggles (M23: it fills and pops once when it becomes saved). */
export function SaveableTile({ saved: initial = false, ...tile }: DemoTile) {
  const [saved, setSaved] = useState(initial);
  return <JobTile {...tile} saved={saved} onSavedChange={setSaved} />;
}
