"use client";

import { useMemo, useRef } from "react";
import { OfficeSettings, type SettingsServices } from "@/components/office/OfficeSettings";
import { ToastProvider } from "@/components/overlays/Toast";
import { parseSettingsInput, type SettingsPageData, type SettingsTab, type SettingsValues } from "@/lib/office-settings";

export function OfficeSettingsDemo({ data, tab, state }: { data: SettingsPageData; tab: SettingsTab; state: string }) {
  const team = useRef(data.team);
  const services = useMemo<SettingsServices>(() => {
    return {
      async save(input) {
        if (state === "save-error") return { ok: false, error: "unavailable" };
        const parsed = parseSettingsInput(input);
        if (!parsed.ok) return { ok: false, error: "invalid", fields: parsed.fields };
        return { ok: true, record: { version: String(Number(input.version) + 1), values: { ...data.record.values, ...parsed.values } as SettingsValues, enabledTrades: input.enabledTrades ?? data.record.enabledTrades } };
      },
      async preview() { return { ok: true, examples: data.examples }; },
      async coverage() { return { ok: true, count: { inside: 12, unlocated: 3, total: 25 } }; },
      async team(input) {
        if (input.operation === "preview-add") return { ok: true, before: "CUSTOMER", email: input.email.trim().toLowerCase() };
        if (input.operation === "add") team.current = [...team.current, { email: input.email, since: new Date().toISOString() }];
        else team.current = team.current.filter(person => person.email !== input.email);
        return { ok: true, team: team.current };
      },
    };
  }, [data, state]);
  return <ToastProvider initial={state === "saved" ? { message: "Saved" } : undefined}><OfficeSettings data={data} initialTab={tab} state={state} services={services} /></ToastProvider>;
}
