"use client";

import { useRef } from "react";

import { Waitlist } from "@/components/waitlist/Waitlist";
import type { Coverage } from "@/lib/geo/coverage";
import type { WaitlistResult, WaitlistState } from "@/lib/waitlist";

export function WaitlistDemo({ state, coverage }: { state: WaitlistState; coverage: Coverage }) {
  const saved = useRef(new Set<string>());
  return <Waitlist location="Wellington" coverage={coverage} initialState={state} initialEmail={state === "empty" ? "" : "neighbour@example.test"} submit={async (form): Promise<WaitlistResult> => {
    const key = `${form.get("email")}|${form.get("suburb")}`;
    if (saved.current.has(key)) return { status: "already-on-list" };
    saved.current.add(key);
    return { status: "joined" };
  }} />;
}
