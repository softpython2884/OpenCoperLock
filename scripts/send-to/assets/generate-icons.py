#!/usr/bin/env python3
"""Regenerate opencoperlock.ico / opencoperlock.png from the app's real brand SVG.

Source of truth: apps/web/public/icon-maskable.svg (violet gradient + white padlock). We only
RASTERIZE it — the SVG itself is never modified. A gentle rounded-square mask (matching the in-app
Logo's rounded corners) is applied so the result reads as a proper desktop-app icon.

    pip install cairosvg pillow
    python3 scripts/send-to/assets/generate-icons.py
"""
import io
import os

import cairosvg
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
SRC = os.path.join(REPO, "apps/web/public/icon-maskable.svg")
R = 1024
SIZES = [256, 128, 64, 48, 32, 16]


def main() -> None:
    png_bytes = cairosvg.svg2png(url=SRC, output_width=R, output_height=R)
    art = Image.open(io.BytesIO(png_bytes)).convert("RGBA")

    mask = Image.new("L", (R, R), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, R - 1, R - 1], radius=int(R * 0.18), fill=255)
    out = Image.new("RGBA", (R, R), (0, 0, 0, 0))
    out.paste(art, (0, 0), mask)

    out.resize((256, 256), Image.LANCZOS).save(os.path.join(HERE, "opencoperlock.png"), "PNG")
    frames = [out.resize((s, s), Image.LANCZOS) for s in SIZES]
    frames[0].save(os.path.join(HERE, "opencoperlock.ico"), "ICO", sizes=[(s, s) for s in SIZES])
    print("wrote opencoperlock.png and opencoperlock.ico from", os.path.relpath(SRC, REPO))


if __name__ == "__main__":
    main()
