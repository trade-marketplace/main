// Colour modes. One `data-mode` attribute on <html> switches the palette (src/styles/tokens.css):
// customer = green (Leaf/Lime), trade = orange (Hi-Vis/Amber), office = Forest/Mint.
// Safe on server and browser: no secrets, no database.

export const MODES = ["customer", "trade", "office"] as const;
export type Mode = (typeof MODES)[number];

/**
 * The account roles that pick a mode. These will come from the database once the schema has users (#86) and
 * sign-in exists (#101); keep the names in step with the schema's Role enum.
 */
export const ROLES = ["CUSTOMER", "TRADIE", "ADMIN"] as const;
export type Role = (typeof ROLES)[number];

/** Signed out, or a role we don't recognise, always gets the customer palette. */
export const DEFAULT_MODE: Mode = "customer";

export function isMode(value: unknown): value is Mode {
  return typeof value === "string" && (MODES as readonly string[]).includes(value);
}

/** CUSTOMER → customer, TRADIE → trade, ADMIN → office, signed out (null/undefined) → customer. */
export function modeForRole(role: Role | null | undefined): Mode {
  switch (role) {
    case "CUSTOMER":
      return "customer";
    case "TRADIE":
      return "trade";
    case "ADMIN":
      return "office";
    case null:
    case undefined:
      return DEFAULT_MODE;
    default: {
      // A new role added to the schema must be given a mode here; TypeScript fails until it is.
      const unhandled: never = role;
      void unhandled;
      return DEFAULT_MODE;
    }
  }
}
