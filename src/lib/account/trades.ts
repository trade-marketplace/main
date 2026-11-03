import { z } from "zod";
import { parseLicenceNumber, SIGNUP_TRADES, type SignupTrade } from "@/lib/auth/worker-signup";

export type TradeRow = {
  trade: SignupTrade;
  licence: { id: string; number: string; status: "PENDING" | "VERIFIED" | "REJECTED"; expiresOn: string | null; rejectionReason: string | null; hasDocument: boolean } | null;
};
export type TradeSnapshot = { rows: TradeRow[]; today: string };
export type TradeInput = { trade: string; number: string; expiresOn: string };
export type TradeErrors = Partial<Record<"trade" | "number" | "expiresOn" | "document", string>>;
export type TradeResult = { ok: true; snapshot: TradeSnapshot } | { ok: false; error: "invalid"; fields: TradeErrors } | { ok: false; error: "unavailable" | "forbidden" | "session-expired" | "try-later"; message?: string };
export type TradeSave = (form: FormData) => Promise<TradeResult>;
export const LICENCE_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
export const DOCUMENT_ACCEPT = ".pdf,.jpg,.jpeg,.png,.heic,.heif,application/pdf,image/jpeg,image/png,image/heic,image/heif";

export function licenceToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Auckland", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export function licenceState(row: TradeRow, today: string): "none" | "checked" | "checking" | "rejected" | "expired" | "expiring" {
  if (row.trade === "OTHER") return "none";
  const licence = row.licence;
  if (!licence || licence.status === "PENDING") return "checking";
  if (licence.status === "REJECTED") return "rejected";
  if (licence.expiresOn && licence.expiresOn < today) return "expired";
  const end = new Date(`${today}T00:00:00Z`); end.setUTCDate(end.getUTCDate() + 30);
  return licence.expiresOn && licence.expiresOn <= end.toISOString().slice(0, 10) ? "expiring" : "checked";
}
export function parseTradeInput(input: TradeInput, today = licenceToday()): { ok: true; data: { trade: SignupTrade; number: string; expiresOn: string | null } } | { ok: false; fields: TradeErrors } {
  const trade = SIGNUP_TRADES.find(item => item.value === input.trade);
  if (!trade) return { ok: false, fields: { trade: "Pick a trade." } };
  if (trade.value === "OTHER") return { ok: true, data: { trade: trade.value, number: "", expiresOn: null } };
  const fields: TradeErrors = {};
  const number = parseLicenceNumber(trade.value, input.number);
  if (!number.ok) fields.number = number.message;
  const date = z.iso.date().safeParse(input.expiresOn);
  if (!date.success || input.expiresOn < today) fields.expiresOn = "Enter a current expiry date.";
  if (Object.keys(fields).length || !number.ok) return { ok: false, fields };
  return { ok: true, data: { trade: trade.value, number: number.number, expiresOn: input.expiresOn } };
}
export function readTradeForm(form: FormData): TradeInput {
  return { trade: String(form.get("trade") ?? ""), number: String(form.get("number") ?? ""), expiresOn: String(form.get("expiresOn") ?? "") };
}
export const tradeLabel = (trade: SignupTrade) => SIGNUP_TRADES.find(item => item.value === trade)!.label;
