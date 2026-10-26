// Self-hosted font files (public/fonts/, licences next to them). The @font-face rules that use them live in
// src/styles/tokens.css; these are preloaded from the root layout so text renders in Roboto Flex straight away.

export type FontPreload = {
  href: string;
  /** "low" keeps a big file from competing with the page's text font and hero image. */
  fetchPriority: "high" | "low";
};

export const FONT_PRELOADS: readonly FontPreload[] = [
  // Trade Display + Trade UI: one 326 KB variable file. Needed for every word on every page.
  { href: "/fonts/roboto-flex/RobotoFlex.woff2", fetchPriority: "high" },
  // Material Symbols Rounded: 5.4 MB (every icon). Preloaded at low priority until it is subset (#284).
  { href: "/fonts/material-symbols/MaterialSymbolsRounded.woff2", fetchPriority: "low" },
];
