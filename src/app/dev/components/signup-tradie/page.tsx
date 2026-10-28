import type { Metadata } from "next";

import { SignupDetails } from "@/components/auth/CustomerSignup";
import type { SignUpState } from "@/server/auth/actions";
import { guardDevPage } from "@/server/dev-pages";

export const metadata: Metadata = { title: "Tradie sign up (dev)", robots: { index: false, follow: false } };
const values = { firstName: "Jack", lastName: "Wilson", email: "jack@example.test", phone: "027 555 0192", role: "TRADIE", terms: "on", trades: "ELECTRICAL,GAS", licence_ELECTRICAL: "E 123456", licence_GAS: "PGDB 44120", baseSuburb: "Invercargill", radiusKm: "25" };
const STATES: Record<string, SignUpState> = {
  "licence-error": { ok: false, error: "invalid", fieldErrors: { licence_ELECTRICAL: "Use E 123456 or EW012345." }, values: { ...values, licence_ELECTRICAL: "wrong-number" } },
  other: { ok: false, error: "invalid", fieldErrors: {}, values: { ...values, trades: "OTHER" } },
  "all-trades": { ok: false, error: "invalid", fieldErrors: {}, values: { ...values, trades: "ELECTRICAL,PLUMBING,GAS,CONSTRUCTION,OTHER", licence_PLUMBING: "PGDB 98211", licence_CONSTRUCTION: "BP 123456", baseSuburb: "Win" } },
  "email-taken": { ok: false, error: "email-taken", values },
  invalid: { ok: false, error: "invalid", fieldErrors: { trades: "Choose a trade.", baseSuburb: "Enter a suburb." }, values: { ...values, trades: "", baseSuburb: "" } },
  unavailable: { ok: false, error: "unavailable", values },
  "try-later": { ok: false, error: "try-later", values },
  success: { ok: true, status: "check-email", email: values.email },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
export default async function TradieSignupPreview({ searchParams }: { searchParams: SearchParams }) {
  guardDevPage();
  const { state } = await searchParams;
  const key = typeof state === "string" ? state : "";
  return <SignupDetails role="tradie" initialState={Object.hasOwn(STATES, key) ? STATES[key] : null} initialTradeStep={key !== "email-taken" && key !== "account"}
    previewPending={key === "loading"} previewOffline={key === "offline"} previewAreaState={key === "loading" || key === "area-loading" ? "loading" : key === "other" || key === "area-unavailable" ? "unavailable" : undefined} previewAreaSuggestions={key === "all-trades" ? [{ id: "demo-windsor", label: "Windsor, Invercargill", point: { lat: -46.391, lng: 168.367 } }] : undefined} key={key} />;
}
