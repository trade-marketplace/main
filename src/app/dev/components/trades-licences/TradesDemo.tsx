"use client";
import { TradesLicences } from "@/components/account/TradesLicences";
import { useRef } from "react";
import { parseTradeInput, readTradeForm, type TradeSave, type TradeSnapshot } from "@/lib/account/trades";

export function TradesDemo({ snapshot, state, network = false }: { snapshot: TradeSnapshot; state: string; network?: boolean }) {
  const current = useRef(snapshot);
  const save: TradeSave = async form => {
    if (state === "save-error") return { ok: false, error: "unavailable" };
    const parsed = parseTradeInput(readTradeForm(form), snapshot.today);
    if (!parsed.ok) return { ok: false, error: "invalid", fields: parsed.fields };
    const data = parsed.data;
    current.current = { ...current.current, rows: [...current.current.rows.filter(row => row.trade !== data.trade), { trade: data.trade, licence: data.trade === "OTHER" ? null : { id: `demo-${data.trade}`, number: data.number, status: "PENDING", expiresOn: data.expiresOn, rejectionReason: null, hasDocument: true } }] };
    return { ok: true, snapshot: current.current };
  };
  return <TradesLicences initial={snapshot} save={network ? undefined : save} preview={state === "offline" || state === "save-error" || state === "add" ? state : undefined} />;
}
