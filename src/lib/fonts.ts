// Self-hosted font files (public/fonts/, licences next to them). The @font-face rules that use them live in
// src/styles/tokens.css; these are preloaded from the root layout so text renders in Roboto Flex straight away.

export type FontPreload = {
  href: string;
  fetchPriority: "high" | "auto";
};

export const FONT_PRELOADS: readonly FontPreload[] = [
  // Trade Display + Trade UI: one 326 KB variable file. Needed for every word on every page.
  { href: "/fonts/roboto-flex/RobotoFlex.woff2", fetchPriority: "high" },
  // The subset is small enough to preload at normal browser priority.
  { href: "/fonts/material-symbols/MaterialSymbolsRounded.woff2", fetchPriority: "auto" },
];
