# Fonts (self-hosted)

Copied unchanged from `docs/design/fonts/`. The paths match the `@font-face` rules in `src/styles/tokens.css`,
so don't move or rename them without updating that file (Matt reviews both).

| File | Used as | Licence |
|---|---|---|
| `roboto-flex/RobotoFlex.woff2` | `Trade Display` (wght 900, wdth 151, opsz 28) and `Trade UI` (wdth 100, opsz 14). One variable file, two family names. | SIL Open Font License 1.1, see `roboto-flex/OFL.txt`. Copyright 2017 The Roboto Flex Project Authors. |
| `material-symbols/MaterialSymbolsRounded.woff2` | `Material Symbols Rounded` icons (ligatures, e.g. `search`). | Apache License 2.0, see `material-symbols/LICENSE`. Copyright Google LLC. |

- Both are preloaded from the root layout (`src/lib/fonts.ts`). Text fonts use `font-display: swap`; the icon font
  keeps `block` from the tokens file so raw icon names don't flash while it loads.
- The OFL lets us bundle and serve the font with the app. It must keep its licence file and must not be sold on its
  own. Apache 2.0 needs the licence and copyright notice kept with the file.
