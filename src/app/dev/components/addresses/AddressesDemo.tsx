"use client";

import { useState } from "react";
import { Addresses } from "@/components/account/Addresses";
import { addressInput, parseAddress, type AddressSource, type AddressState, type SavedAddress } from "@/lib/account/addresses";
import type { AddressSearchResult } from "@/server/geo/address-search";

const base: SavedAddress = { id: "23700000-0000-4000-8000-000000000001", label: "Home", line1: "12 Dee Street", line2: null, suburb: "Central", city: "Invercargill", postcode: "9810", lat: -46.4132, lng: 168.3538, locationSource: "SEARCH", isDefault: true, createdAt: "2026-11-10T00:00:00.000Z" };
const other: SavedAddress = { ...base, id: "23700000-0000-4000-8000-000000000002", label: "Rental", line1: "45 Tay Street", isDefault: false, createdAt: "2026-11-11T00:00:00.000Z" };
async function search(query: string): Promise<AddressSearchResult> {
  return { mode: "search", suggestions: query === "No matches" ? [] : [{ id: "dee-street", label: "12 Dee Street, Central, Invercargill 9810", line1: "12 Dee Street", suburb: "Central", city: "Invercargill", postcode: "9810", point: { lat: -46.4132, lng: 168.3538 }, coverage: { status: "inside", distanceKm: 0 } }] };
}
export function AddressesDemo({ state, headingLevel = 1 }: { state: AddressState; headingLevel?: 1 | 2 }) {
  const [initial] = useState<SavedAddress[]>(() => state === "empty" ? [] : state === "at-limit" ? Array.from({ length: 10 }, (_, i) => ({ ...base, id: `23700000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`, label: i === 0 ? "Home" : `Rental ${i}`, isDefault: i === 0 })) : [base, other]);
  const [source] = useState(() => fixtureSource(initial));
  const draft = state === "saving" ? { ...addressInput(base), id: undefined, label: "Garage" } : state === "searching" || state === "search-unavailable" ? { ...addressInput(), line1: "12 Dee" } : undefined;
  return <Addresses initial={state === "error" ? null : initial} source={source} search={search} preview={state} previewInput={draft} headingLevel={headingLevel} />;
}

function fixtureSource(initial: SavedAddress[]): AddressSource {
    let rows = [...initial];
    const result = () => ({ ok: true as const, addresses: [...rows].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || b.createdAt.localeCompare(a.createdAt)) });
    return {
      list: async () => result(),
      save: async input => {
        const parsed = parseAddress(input); if (!parsed.ok) return parsed;
        const data = parsed.data, old = rows.find(row => row.id === data.id);
        if (!old && rows.length >= 10) return { ok: false, error: "limit" };
        const row: SavedAddress = { id: data.id ?? crypto.randomUUID(), label: data.label || null, line1: data.line1, line2: data.line2 || null, suburb: data.suburb, city: data.city, postcode: data.postcode || null,
          lat: data.point?.lat ?? null, lng: data.point?.lng ?? null, locationSource: data.locationSource ?? old?.locationSource ?? null, isDefault: old?.isDefault ?? rows.length === 0, createdAt: old?.createdAt ?? new Date().toISOString() };
        rows = [row, ...rows.filter(value => value.id !== row.id)]; return result();
      },
      delete: async id => {
        rows = rows.filter(row => row.id !== id);
        if (rows.length && !rows.some(row => row.isDefault)) {
          const newest = [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
          rows = rows.map(row => ({ ...row, isDefault: row.id === newest.id }));
        }
        return result();
      },
      makeDefault: async id => { rows = rows.map(row => ({ ...row, isDefault: row.id === id })); return result(); },
    };
}
