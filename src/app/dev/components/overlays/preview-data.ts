// Shared by the /dev/components/overlays page (a server component) and its client demos (OverlayDemos.tsx).

/** What `?open=` can open. */
export const OPEN_IDS = [
  "dialog",
  "confirm",
  "destructive",
  "confirm-error",
  "session-expired",
  "dialog-on-phone",
  "long-dialog",
  "drawer",
  "long-drawer",
  "sheet",
  "menu",
  "long-menu",
  "toast",
  "long-toast",
] as const;
export type OpenId = (typeof OPEN_IDS)[number];

/** Names and words of any length must wrap (the “What if…” cases). */
export const LONG_NAME = "Wiremu Te Rangi-Hēnare from Ōtautahi Electrical Services";
export const LONG_WORD = "Taumatawhakatangihangakoauauotamateaturipukakapikimaungahoronukupokaiwhenuakitanatahu";
