import "server-only";

import type { Point } from "@/lib/geo/distance";

// What an address search provider gives us (#97). Mapbox today (mapbox.ts); tests use a fake.

/** One address the provider found. `point` is where the address is (the front door, or near it). */
export type AddressSuggestion = {
  /** The provider's id for this result. */
  id: string;
  /** One line to show in the list, e.g. "12 Dee Street, Invercargill 9810". */
  label: string;
  line1: string;
  suburb: string;
  city: string;
  postcode: string | null;
  point: Point;
};

export type AddressSearchOptions = {
  /** Results near here come first (the coverage centre). */
  near: Point;
  limit: number;
  signal?: AbortSignal;
};

export interface AddressSearchProvider {
  /** Addresses in New Zealand matching `query`, nearest to `near` first. Throws AddressSearchUnavailableError. */
  suggest(query: string, options: AddressSearchOptions): Promise<AddressSuggestion[]>;
}

/** The provider couldn't answer: down, too slow, rate-limited, or our token was refused. */
export class AddressSearchUnavailableError extends Error {
  constructor(reason: string, options?: { cause?: unknown }) {
    super(`Address search is unavailable: ${reason}`, options);
    this.name = "AddressSearchUnavailableError";
  }
}
