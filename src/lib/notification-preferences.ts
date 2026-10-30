/** Choices only. This catalogue never registers or enables delivery providers. No SMS at launch (#63). */
export const PREFERENCE_CHANNELS = ["EMAIL", "PUSH"] as const;
export type PreferenceChannel = typeof PREFERENCE_CHANNELS[number];
export type PreferenceRole = "CUSTOMER" | "TRADIE";
export type PreferenceDefinition = { event: string; label: string; email: boolean; push: boolean; locks?: Partial<Record<PreferenceChannel, boolean>>; reason?: string };

const customer: readonly PreferenceDefinition[] = [
  { event: "job.priced", label: "Your price is ready", email: true, push: true },
  { event: "job.claimed", label: "A tradie takes your job", email: true, push: true },
  { event: "message.received", label: "New message", email: false, push: true },
  { event: "variation.priced", label: "Extra work needs your OK", email: true, push: true, locks: { EMAIL: true, PUSH: true }, reason: "Always on: you need to decide." },
  { event: "job.submitted", label: "Job finished, please check", email: true, push: true },
  { event: "job.paid", label: "Receipts", email: true, push: false, locks: { EMAIL: true, PUSH: false }, reason: "Receipts require email." },
];
const tradie: readonly PreferenceDefinition[] = [
  { event: "job.posted", label: "New job", email: true, push: true },
  { event: "job.priced", label: "Price ready", email: true, push: true },
  { event: "job.claimed", label: "Job taken", email: true, push: true },
  { event: "job.window_booked", label: "Time booked", email: true, push: true },
  { event: "message.received", label: "New message", email: false, push: true },
  { event: "variation.approved", label: "Extra work approved", email: true, push: true },
  { event: "variation.declined", label: "Extra work declined", email: true, push: true },
  { event: "job.signed_off", label: "Job signed off", email: true, push: true },
  { event: "job.auto_completed", label: "Job completed", email: true, push: true },
  { event: "job.cancelled", label: "Job cancelled", email: true, push: true },
  { event: "payout.queued", label: "Payout queued", email: true, push: true },
  { event: "payout.paid", label: "Payout paid", email: true, push: true },
  { event: "bounty.available", label: "Quote bounty available", email: true, push: true },
  { event: "crew.invited", label: "Crew invitation", email: true, push: true },
  { event: "licence.verified", label: "Licence checked", email: true, push: true },
  { event: "licence.rejected", label: "Check your licence", email: true, push: true },
];

export const preferenceDefinitions = (role: PreferenceRole) => role === "CUSTOMER" ? customer : tradie;
export type PreferenceRow = { event: string; label: string; channels: Record<PreferenceChannel, { enabled: boolean; locked: boolean; reason?: string }> };
export type PreferenceChange = { event: string; channel: PreferenceChannel; enabled: boolean };
export type PreferenceError = "unavailable" | "session-expired" | "forbidden" | "invalid" | "locked";
export type PreferenceSnapshot = { rows: PreferenceRow[] };
export type PreferenceLoadResult = { ok: true; snapshot: PreferenceSnapshot } | { ok: false; error: PreferenceError };
export type PreferenceSaveResult = { ok: true; change: PreferenceChange } | { ok: false; error: PreferenceError };
export type PreferenceSource = { load: () => Promise<PreferenceLoadResult>; save: (change: PreferenceChange) => Promise<PreferenceSaveResult> };

export function preferenceSnapshot(role: PreferenceRole, saved: readonly PreferenceChange[]): PreferenceSnapshot {
  return { rows: preferenceDefinitions(role).map(definition => ({
    event: definition.event, label: definition.label,
    channels: Object.fromEntries(PREFERENCE_CHANNELS.map(channel => {
      const locked = definition.locks?.[channel];
      return [channel, { enabled: locked ?? saved.find(row => row.event === definition.event && row.channel === channel)?.enabled ?? (channel === "EMAIL" ? definition.email : definition.push), locked: locked !== undefined, reason: locked !== undefined ? definition.reason : undefined }];
    })) as PreferenceRow["channels"],
  })) };
}

export const preferenceKey = (change: Pick<PreferenceChange, "event" | "channel">) => `${change.event}:${change.channel}`;
