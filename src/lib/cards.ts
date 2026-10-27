// The rules behind cards, tiles and rows (#76), as plain functions so they can be unit tested without a browser.
// The components are in src/components/cards. Safe on server and browser.

/** The kinds of work (sitemap.json `categories`): the four main trades and Other, which is any kind of labour. */
export const CATEGORIES = ["electrical", "plumbing", "construction", "gas", "other"] as const;
export type Category = (typeof CATEGORIES)[number];

type CategoryInfo = {
  name: string;
  /** The line under the name on its tile. */
  sub: string;
  /** The tint behind the art (tokens.css). */
  tint: string;
  /** A 3D illustration in public/images/categories, or a Material Symbols icon when there's no art. */
  art: { image: string; width: number; height: number } | { icon: string; ink: string };
};

/** What each category tile shows, word for word from the mockups (screens.html cus-home, pages.html w-c-home). */
export const CATEGORY_INFO: Record<Category, CategoryInfo> = {
  electrical: {
    name: "Electrical",
    sub: "and related",
    tint: "var(--trade-cat-electrical)",
    art: { image: "/images/categories/meter.png", width: 240, height: 240 },
  },
  plumbing: {
    name: "Plumbing",
    sub: "and related",
    tint: "var(--trade-cat-plumbing)",
    art: { image: "/images/categories/pipe.png", width: 240, height: 240 },
  },
  construction: {
    name: "Construction",
    sub: "and related",
    tint: "var(--trade-cat-construction)",
    art: { image: "/images/categories/gun.png", width: 180, height: 240 },
  },
  gas: {
    name: "Gas fitting",
    sub: "and related",
    tint: "var(--trade-cat-gas)",
    art: { icon: "local_fire_department", ink: "var(--trade-cat-gas-ink)" },
  },
  other: {
    name: "Other",
    sub: "anything else",
    tint: "var(--trade-cat-other)",
    art: { icon: "handyman", ink: "var(--trade-forest)" },
  },
};

export function isCategory(value: unknown): value is Category {
  return typeof value === "string" && (CATEGORIES as readonly string[]).includes(value);
}

/**
 * Up to two letters for an avatar: first and last name ("Jack Wilson" → "JW", "Mere" → "M", "Aroha King-Tūhoe" →
 * "AK"). Letters are upper-cased for the locale; anything that isn't a letter is skipped.
 */
export function initials(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .map((word) => word.match(/\p{L}/u)?.[0] ?? "")
    .filter(Boolean);
  if (words.length === 0) return "?";
  const letters = words.length === 1 ? words[0] : words[0] + words[words.length - 1];
  return letters.toLocaleUpperCase("en-NZ");
}

/** The tile's small line: "4 km · Windsor" (formatKm from src/lib/geo/distance.ts), or whichever of the two is known. */
export function tileMeta(distance?: string | null, suburb?: string | null): string {
  return [distance, suburb].map((part) => part?.trim()).filter(Boolean).join(" · ");
}
