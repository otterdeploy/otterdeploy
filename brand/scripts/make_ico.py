#!/usr/bin/env python3
"""
Packs the raster favicons into a single multi-resolution favicon.ico.

Only legacy consumers reach for this — modern browsers take `favicon.svg` and
scale it themselves — but crawlers, feed readers, and Windows shortcuts still
ask for `/favicon.ico` by convention and log a 404 when it is missing.

Run `brand/scripts/build.sh`; this script is step 4 of 4.
"""

from __future__ import annotations

import pathlib

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[2]
# Mirrors APP_PUBLIC in rasterize.ts — every app that serves icons from its own
# origin gets its own .ico, packed from that app's own PNGs.
APP_PUBLIC = (ROOT / "apps/web/public", ROOT / "apps/www/public")
SIZES = (16, 32, 48)


def main() -> None:
    for out in APP_PUBLIC:
        frames = [Image.open(out / f"favicon-{s}x{s}.png").convert("RGBA") for s in SIZES]
        # Pillow writes the extra sizes from `sizes`, resampling the base image;
        # feed it the largest so every downscale starts from the most detail.
        base = max(frames, key=lambda im: im.size[0])
        base.save(out / "favicon.ico", format="ICO", sizes=[(s, s) for s in SIZES])

        written = Image.open(out / "favicon.ico")
        print(f"{out.relative_to(ROOT)}/favicon.ico: {sorted(written.info['sizes'])}")


if __name__ == "__main__":
    main()
