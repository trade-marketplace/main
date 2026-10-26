"""Static Roboto Flex instances for the share images (#218).

    pip install fonttools brotli
    python3 scripts/brand/og-fonts.py

The share images are drawn by next/og (Satori), which can't read WOFF2 or variable fonts. This pins the app's
variable Roboto Flex (public/fonts/roboto-flex/RobotoFlex.woff2) at the two settings the tokens use and saves them
as plain TTF files next to it. Run it again if the font file or the axes in src/styles/tokens.css change.
"""

from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

FOLDER = Path(__file__).resolve().parents[2] / "public" / "fonts" / "roboto-flex"
SOURCE = FOLDER / "RobotoFlex.woff2"

# Same axes as --trade-display-axes / --trade-ui-axes in src/styles/tokens.css; every other axis stays at default.
INSTANCES = {
    # Trade Display: headings, weight 900.
    "RobotoFlex-Display.ttf": {"wght": 900, "wdth": 151, "opsz": 28},
    # Trade UI: body text, regular weight.
    "RobotoFlex-UI.ttf": {"wght": 400, "wdth": 100, "opsz": 14},
}


def main() -> None:
    for name, axes in INSTANCES.items():
        font = TTFont(SOURCE)
        # Pin every axis (unlisted ones at their default) so the result is a static font, not a smaller variable one.
        pinned = {axis.axisTag: axes.get(axis.axisTag, axis.defaultValue) for axis in font["fvar"].axes}
        static = instancer.instantiateVariableFont(font, pinned, updateFontNames=False)
        static.flavor = None  # plain TrueType, not WOFF2
        static.save(FOLDER / name)
        print(f"{name}: {axes}")


if __name__ == "__main__":
    main()
