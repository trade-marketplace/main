"""Regenerate the served icon font from Google's unmodified design reference (fonttools[woff])."""

import json
import subprocess
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "docs/design/fonts/MaterialSymbolsRounded.woff2"
TARGET = ROOT / "public/fonts/material-symbols/MaterialSymbolsRounded.woff2"


def main():
    candidates = set(json.loads(subprocess.check_output(
        ["node", ROOT / "scripts/brand/material-symbol-names.mjs"], text=True
    )))
    font = TTFont(SOURCE, recalcTimestamp=False)
    letters = {glyph: chr(code) for code, glyph in font.getBestCmap().items() if code < 128}
    kept = set()

    # Ordinary subsetting with a-z would retain every icon: every name is made from the same alphabet.
    # Restrict the ligature substitutions first, then let fontTools keep their outlines and variation data.
    for lookup in font["GSUB"].table.LookupList.Lookup:
        for subtable in lookup.SubTable:
            table = getattr(subtable, "ExtSubTable", subtable)
            if not hasattr(table, "ligatures"):
                continue
            for first, rules in list(table.ligatures.items()):
                retained = []
                for rule in rules:
                    name = "".join(letters.get(g, "?") for g in [first, *rule.Component])
                    if name in candidates:
                        kept.add(name)
                        retained.append(rule)
                if retained:
                    table.ligatures[first] = retained
                else:
                    del table.ligatures[first]

    if not kept:
        raise ValueError("No usable icon ligatures found in the reference font")
    options = subset.Options()
    options.layout_features = ["*"]
    # Ordinary text fallbacks of unsupported names should behave just as in the reference.
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=[code for code in font.getBestCmap() if code < 128])
    subsetter.subset(font)
    font.save(TARGET)
    print(f"{len(kept)} icon names: {SOURCE.stat().st_size:,} → {TARGET.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
