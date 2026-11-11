"use client";
import { useState } from "react";
import { WorkArea } from "@/components/account/WorkArea";
import { TextLink } from "@/components/TextLink";
import { parseWorkArea, type WorkAreaSnapshot, type WorkAreaState } from "@/lib/account/work-area";

export function WorkAreaDemo({ state, network }: { state: WorkAreaState; network: boolean }) {
  const [retry, setRetry] = useState(false);
  const point = { lat: -46.4132, lng: 168.3538 };
  const snapshot: WorkAreaSnapshot = { baseSuburb: "Invercargill", point: state === "field-error" ? null : point, radiusKm: 25,
    available: state !== "unavailable-off" && state !== "field-error", paused: state === "paused", trades: ["ELECTRICAL", "OTHER"] };
  return <>
    {state === "from-jobs" && <TextLink href="/jobs">Back to jobs</TextLink>}
    <WorkArea key={retry ? "retry" : "initial"} initial={state === "load-error" && !retry ? null : snapshot} preview={retry ? "ready" : state} onRetry={() => setRetry(true)} next={state === "from-jobs" ? "/jobs" : undefined}
      search={async query => ({ mode: "search", suggestions: query.trim() === "No matches" ? [] : [{ id: "invercargill", label: query.trim() === "Windsor" ? "Windsor, Invercargill" : "Invercargill", point }] })}
      save={network ? undefined : async input => {
        if (state === "error" && !retry) return { ok: false, error: "unavailable" };
        const parsed = parseWorkArea(input);
        return parsed.ok ? { ok: true, snapshot: { ...snapshot, ...parsed.data } } : { ok: false, error: "invalid", fields: parsed.fields };
      }} setAvailable={network ? undefined : async available => ({ ok: true, snapshot: { ...snapshot, available } })} />
  </>;
}
