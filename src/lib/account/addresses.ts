import { z } from "zod";

export const MAX_SAVED_ADDRESSES = 10;
export const ADDRESS_STATES = ["list", "empty", "add-dialog", "searching", "search-unavailable", "field-error", "saving", "saved", "delete-dialog", "at-limit", "error", "offline", "loading"] as const;
export type AddressState = typeof ADDRESS_STATES[number];
export type SavedAddress = {
  id: string; label: string | null; line1: string; line2: string | null; suburb: string; city: string; postcode: string | null;
  lat: number | null; lng: number | null; locationSource: "SEARCH" | "PIN" | "TYPED" | null; isDefault: boolean; createdAt: string;
};
const point = z.object({ lat: z.number().finite().min(-90).max(90), lng: z.number().finite().min(-180).max(180) });
export const savedAddressInput = z.object({
  id: z.uuid().optional(),
  label: z.string().trim().max(40, "Use 40 characters or fewer.").default(""),
  line1: z.string().trim().min(1, "Enter the address.").max(200, "Use 200 characters or fewer."),
  line2: z.string().trim().max(200, "Use 200 characters or fewer.").default(""),
  suburb: z.string().trim().min(1, "Enter the suburb.").max(100, "Use 100 characters or fewer."),
  city: z.string().trim().min(1, "Enter the city.").max(100, "Use 100 characters or fewer."),
  postcode: z.string().trim().regex(/^(\d{4})?$/, "Enter a 4-digit postcode.").default(""),
  // Null retains a legacy stored source/point, only when its address is unchanged; the server checks that.
  locationSource: z.enum(["SEARCH", "TYPED"]).nullable(),
  point: point.nullable().default(null),
}).superRefine((value, context) => {
  if (value.locationSource === "SEARCH" && !value.point) context.addIssue({ code: "custom", path: ["line1"], message: "Choose an address from the search results." });
  if (value.locationSource === "TYPED" && value.point) context.addIssue({ code: "custom", path: ["line1"], message: "Type the address again without a location." });
  if (value.locationSource === null && !value.id) context.addIssue({ code: "custom", path: ["line1"], message: "Choose an address or type it by hand." });
});
export type AddressInput = z.output<typeof savedAddressInput>;
export type AddressFields = Partial<Record<keyof AddressInput, string>>;
export type AddressResult = { ok: true; addresses: SavedAddress[] } | { ok: false; error: "invalid" | "forbidden" | "limit" | "unavailable" | "session-expired"; fields?: AddressFields };
export type AddressSource = { list(): Promise<AddressResult>; save(input: AddressInput): Promise<AddressResult>; delete(id: string): Promise<AddressResult>; makeDefault(id: string): Promise<AddressResult> };
export function parseAddress(input: unknown): { ok: true; data: AddressInput } | { ok: false; error: "invalid"; fields: AddressFields } {
  const result = savedAddressInput.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  const fields: AddressFields = {};
  for (const issue of result.error.issues) { const field = issue.path[0] as keyof AddressInput; if (!fields[field]) fields[field] = issue.message; }
  return { ok: false, error: "invalid", fields };
}
export function addressInput(address?: SavedAddress): AddressInput {
  return address ? { id: address.id, label: address.label ?? "", line1: address.line1, line2: address.line2 ?? "", suburb: address.suburb, city: address.city, postcode: address.postcode ?? "",
    locationSource: address.locationSource === "SEARCH" || address.locationSource === "TYPED" ? address.locationSource : null,
    point: address.lat === null || address.lng === null ? null : { lat: address.lat, lng: address.lng } }
    : { label: "", line1: "", line2: "", suburb: "", city: "", postcode: "", locationSource: "TYPED", point: null };
}
export function addressLines(address: Pick<SavedAddress, "line1" | "line2" | "suburb" | "city" | "postcode">): [string, string] {
  return [[address.line2, address.line1].filter(Boolean).join(", "), [address.suburb, address.city, address.postcode].filter(Boolean).join(", ")];
}
