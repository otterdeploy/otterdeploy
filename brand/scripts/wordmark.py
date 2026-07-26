#!/usr/bin/env python3
"""
Outlines the "otterdeploy" wordmark to SVG path data.

The lockups must render identically everywhere — GitHub strips `@font-face`
from SVGs and design tools will not have Geist installed — so the wordmark ships
as vector outlines rather than live text. Shaping goes through HarfBuzz with the
same variable-font instance and OpenType features the product UI uses
(`wght` 600, `cv11`, `ss01` per DESIGN.md), so the outlines match the running app.

Writes brand/logo/_wordmark.json, consumed by build_svgs.py.
"""

from __future__ import annotations

import json
import pathlib

import uharfbuzz as hb
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = pathlib.Path(__file__).resolve().parents[2]
FONT = ROOT / "apps/web/node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2"
OUT = ROOT / "brand/logo/_wordmark.json"

TEXT = "otterdeploy"
WEIGHT = 600
FEATURES = {"cv11": True, "ss01": True}
# DESIGN.md's display tracking. Applied per-glyph in font units.
TRACKING_EM = -0.025


def main() -> None:
    # Pin the variable axis before outlining: a default-instance glyf table would
    # give us Regular contours, not the Semibold the wordmark is specified at.
    font = TTFont(FONT)
    font = instancer.instantiateVariableFont(font, {"wght": WEIGHT}, inplace=True)

    buf = hb.Buffer()
    buf.add_str(TEXT)
    buf.guess_segment_properties()

    # Shape against the *instantiated* font, not the source woff2: advances at
    # wght 600 differ from the variable default, and mixing 400 advances with
    # 600 outlines would space the wordmark wrong.
    face = hb.Face(_to_bytes(font))
    hb_font = hb.Font(face)
    upem = face.upem
    hb_font.scale = (upem, upem)
    hb.shape(hb_font, buf, FEATURES)

    glyph_set = font.getGlyphSet()
    order = font.getGlyphOrder()
    tracking = TRACKING_EM * upem

    parts: list[str] = []
    x = 0.0
    bounds = BoundsPen(glyph_set)
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        name = order[info.codepoint]
        # Flip Y: font space is y-up, SVG is y-down.
        transform = (1, 0, 0, -1, x + pos.x_offset, -pos.y_offset)
        pen = SVGPathPen(glyph_set)
        glyph_set[name].draw(TransformPen(pen, transform))
        if d := pen.getCommands():
            parts.append(d)
        glyph_set[name].draw(TransformPen(bounds, transform))
        x += pos.x_advance + tracking

    # Trailing tracking is a gap, not part of the mark.
    advance = x - tracking

    ascender = font["hhea"].ascender
    descender = font["hhea"].descender
    cap_height = font["OS/2"].sCapHeight
    x_height = font["OS/2"].sxHeight

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(
            {
                "text": TEXT,
                "path": " ".join(parts),
                "unitsPerEm": upem,
                "advance": advance,
                "ascender": ascender,
                "descender": descender,
                "capHeight": cap_height,
                "xHeight": x_height,
                # Inked bounds in SVG (y-down) space — used to optically centre
                # the wordmark against the mark in the lockups.
                "bbox": {
                    "xMin": bounds.bounds[0],
                    "yMin": bounds.bounds[1],
                    "xMax": bounds.bounds[2],
                    "yMax": bounds.bounds[3],
                },
            },
            indent=2,
        )
        + "\n"
    )
    print(f"wordmark: {advance:.0f}/{upem} em wide, cap {cap_height}, x-height {x_height}")


def _to_bytes(font: TTFont) -> bytes:
    """Serialises to plain sfnt.

    `TTFont.save` preserves the source flavor, so a font loaded from `.woff2`
    saves back as WOFF2 — which HarfBuzz cannot parse. It fails silently, mapping
    every character to `.notdef`, so the wordmark comes out as tofu boxes at
    uniform 500-unit advances. Clearing the flavor is what makes shaping real.
    """
    import io

    font.flavor = None
    buf = io.BytesIO()
    font.save(buf)
    return buf.getvalue()


if __name__ == "__main__":
    main()
