// Launch trade configuration and sign-up validation. A submitted number is never proof of a current licence.
import { z } from "zod";

export const SIGNUP_TRADES = [
  { value: "ELECTRICAL", label: "Electrical", licence: { label: "EWRB registration number", example: "E 123456 or EW012345", pattern: /^[A-Z][A-Z-]*\d+$/ } },
  { value: "PLUMBING", label: "Plumbing", licence: { label: "Plumbing licence number", example: "PGDB 98211", pattern: /^(?:PGDB?)?\d{5}$/ } },
  { value: "GAS", label: "Gas fitting", licence: { label: "Gas fitting licence number", example: "PGDB 44120", pattern: /^(?:PGDB?)?\d{5}$/ } },
  { value: "CONSTRUCTION", label: "Construction", licence: { label: "LBP number", example: "BP 123456", pattern: /^(?:BP)?\d{6}$/ } },
  { value: "OTHER", label: "Other / general labour", licence: null },
] as const;
export type SignupTrade = (typeof SIGNUP_TRADES)[number]["value"];
export type RestrictedSignupTrade = Exclude<SignupTrade, "OTHER">;
export type WorkerSignupField = "trades" | "baseSuburb" | "radiusKm" | `licence_${RestrictedSignupTrade}`;
export type WorkerSignupInput = {
  trades: string[];
  licences: Record<string, string>;
  baseSuburb: string;
  radiusKm: string | number;
  point: { lat: number; lng: number } | null;
};
export type WorkerSignupDetails = {
  trades: SignupTrade[];
  licences: Partial<Record<RestrictedSignupTrade, string>>;
  baseSuburb: string;
  radiusKm: 10 | 25 | 50;
  point: { lat: number; lng: number } | null;
};

const schema = z.object({
  trades: z.array(z.enum(["ELECTRICAL", "PLUMBING", "GAS", "CONSTRUCTION", "OTHER"])).min(1, "Pick at least one trade.").max(5),
  licences: z.record(z.string(), z.string().trim().max(64)).default({}),
  baseSuburb: z.string().trim().min(1, "Enter your work suburb.").max(120, "That suburb name is too long."),
  radiusKm: z.union([z.string(), z.number()]).transform(Number).pipe(z.union([z.literal(10), z.literal(25), z.literal(50)], "Choose 10, 25 or 50 km.")),
  point: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).nullable(),
});

export function parseWorkerSignup(input: unknown): { ok: true; details: WorkerSignupDetails } | { ok: false; errors: Partial<Record<WorkerSignupField, string>> } {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const errors: Partial<Record<WorkerSignupField, string>> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (field === "baseSuburb" || field === "radiusKm") errors[field] ??= issue.message;
      else if (field === "point") errors.baseSuburb ??= "Choose the suburb again, or type it by hand.";
      else if (field === "licences" && typeof issue.path[1] === "string") errors[`licence_${issue.path[1]}` as WorkerSignupField] ??= "That licence number is too long.";
      else errors.trades ??= "Pick at least one trade from the list.";
    }
    return { ok: false, errors };
  }
  const { data } = parsed;
  const errors: Partial<Record<WorkerSignupField, string>> = {};
  const licences: WorkerSignupDetails["licences"] = {};
  for (const trade of SIGNUP_TRADES) {
    if (!trade.licence || !data.trades.includes(trade.value)) continue;
    const number = data.licences[trade.value]?.trim().replace(/\s+/g, " ").toUpperCase() ?? "";
    if (!number) errors[`licence_${trade.value}`] = `Enter your number, for example ${trade.licence.example}.`;
    else if (!trade.licence.pattern.test(number.replace(/\s+/g, ""))) errors[`licence_${trade.value}`] = `Use a number like ${trade.licence.example}. The office checks the licence before restricted work.`;
    else licences[trade.value] = number;
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, details: { ...data, trades: [...new Set(data.trades)], licences } };
}

export function readWorkerSignupForm(form: FormData): WorkerSignupInput {
  const text = (name: string) => typeof form.get(name) === "string" ? String(form.get(name)) : "";
  const lat = text("areaLat");
  const lng = text("areaLng");
  return {
    trades: form.getAll("trades").filter((value): value is string => typeof value === "string"),
    licences: Object.fromEntries(SIGNUP_TRADES.filter((trade) => trade.licence).map((trade) => [trade.value, text(`licence_${trade.value}`)])),
    baseSuburb: text("baseSuburb"),
    radiusKm: text("radiusKm"),
    point: lat && lng ? { lat: Number(lat), lng: Number(lng) } : null,
  };
}

export function workerSignupValues(worker?: WorkerSignupInput): Record<string, string> {
  if (!worker) return {};
  return { trades: worker.trades.join(","), baseSuburb: worker.baseSuburb, radiusKm: String(worker.radiusKm),
    areaLat: worker.point ? String(worker.point.lat) : "", areaLng: worker.point ? String(worker.point.lng) : "",
    ...Object.fromEntries(Object.entries(worker.licences).map(([trade, number]) => [`licence_${trade}`, number])) };
}
