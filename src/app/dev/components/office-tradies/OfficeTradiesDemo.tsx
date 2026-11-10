"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { OfficeTradies, type OfficeTradiesState } from "@/components/office/OfficeTradies";
import { tradiesHref, type TradieDetail, type TradiesQuery } from "@/lib/office-tradies";

export const DEMO_TRADIE = "17400000-0000-4000-8000-000000000001";
const today = "2026-11-05", viewerId = "17400000-0000-4000-8000-000000000099";
function sample(index: number, name: string, trade: TradieDetail["trade"], checked = false, paused = false): TradieDetail {
  const userId = `17400000-0000-4000-8000-${String(index).padStart(12, "0")}`, id = `${userId}:${trade}`;
  return { id, userId, trade, name, joined: "5 Nov 2026", joinedAt: "2026-11-04T22:00:00Z", licenceNumber: trade === "ELECTRICAL" ? "E 220981" : trade === "PLUMBING" ? "PGDB 98211" : "PGDB 44120", expiry: "2027-03-31", status: checked ? "Checked" : "Checking", paused, email: `${name.split(" ")[0].toLowerCase()}@example.test`, suburb: "Invercargill", verifiedBadge: checked && !paused, hasWorkerProfile: true, pausedAt: paused ? "2026-11-04T23:00:00Z" : null,
    licence: { id: `${userId.slice(0, -1)}9`, version: "a".repeat(64), documentHref: `/api/admin/tradies/document?userId=${userId}&trade=${trade}`, status: checked ? "VERIFIED" : "PENDING", reason: null },
    timeline: paused ? [{ id: "pause", action: "Paused", actor: "Matt", at: "2026-11-04T23:00:00Z", when: "5 Nov 2026", note: "Checking updated account details.", reason: null }] : [],
  };
}
export function OfficeTradiesDemo({ query, state, autoSelect }: { query: TradiesQuery; state: string; autoSelect: boolean }) {
  const router = useRouter(), [records, setRecords] = useState(() => [sample(1, "Jack Wilson", "GAS"), sample(2, "Aroha King", "PLUMBING"), sample(3, "Ben Lee", "ELECTRICAL"), sample(4, "Alex Green", "ELECTRICAL", true), sample(5, "Jo Brown", "GAS", true, true)]);
  const rows = records.filter(row => query.tab === "paused" ? row.paused : !row.paused && (query.tab === "verified" ? row.status === "Checked" : row.status !== "Checked")).filter(row => `${row.name} ${row.licenceNumber}`.toLowerCase().includes(query.q.toLowerCase()));
  const selected = records.find(row => row.id === query.selected) ?? (autoSelect ? rows[0] : null);
  const effective = { ...query, selected: selected?.id ?? null };
  const valid: OfficeTradiesState = ["loading", "empty", "error", "offline", "success", "reject", "pause", "unpause", "save-error"].includes(state) ? state as OfficeTradiesState : "default";
  function hrefFor(href: string) { const url = new URL(href, "https://preview.test"); if (!url.searchParams.has("selected")) url.searchParams.set("selected", "none"); return `/dev/components/office-tradies?${url.searchParams}`; }
  return <OfficeTradies query={effective} state={valid} data={{ viewerId, rows, selected: selected ?? null, today, total: rows.length, page: 1, counts: { check: records.filter(row => !row.paused && row.status !== "Checked").length, verified: records.filter(row => !row.paused && row.status === "Checked").length, paused: records.filter(row => row.paused).length } }} hrefFor={hrefFor} navigate={next => router.push(hrefFor(tradiesHref(next)))} refresh={() => {}}
    decide={async input => {
      if (state === "save-error") return { ok: false, error: "unavailable" };
      setRecords(old => old.map(row => row.userId !== input.userId || ((input.kind === "approve" || input.kind === "reject") && row.trade !== input.trade) ? row : {
        ...row, ...(input.kind === "pause" ? { paused: true, pausedAt: "2026-11-05T00:00:00Z", verifiedBadge: false } : input.kind === "unpause" ? { paused: false, pausedAt: null, verifiedBadge: row.status === "Checked" } : { status: input.kind === "approve" ? "Checked" : "Rejected", verifiedBadge: input.kind === "approve" && !row.paused, licence: row.licence ? { ...row.licence, version: "b".repeat(64), status: input.kind === "approve" ? "VERIFIED" : "REJECTED", reason: input.kind === "reject" ? input.reason : null } : null }),
        timeline: [{ id: `decision-${row.timeline.length}`, action: input.kind === "approve" ? "Licence approved" : input.kind === "reject" ? "Licence rejected" : input.kind === "pause" ? "Paused" : "Unpaused", actor: "Matt", at: "2026-11-05T00:00:00Z", when: "5 Nov 2026", note: input.note, reason: input.kind === "reject" ? input.reason : null }, ...row.timeline],
      }));
      return { ok: true };
    }} />;
}
