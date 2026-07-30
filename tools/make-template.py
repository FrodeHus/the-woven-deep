#!/usr/bin/env python3
"""Generate a structural grid template for AI image-edit / img2img tile-sheet generation.

The chroma-key pipeline (generate on solid #ff00ff -> `tools/key-tilesheet.py` ->
`tools/slice-tilesheet.py`) has suffered repeated grid-violation failures: generators drifting off
the cell pitch, oversizing sprites, or drawing across cell borders. Feeding the generator a
template image in image-edit mode -- "paint into this grid" instead of "paint an 8x8 grid from
scratch" -- gives it a structural anchor and raises the hit rate.

The template is a solid #ff00ff canvas with faint guide lines drawn in a NEAR-magenta
(#f000f0): a 1px border on every cell, plus an inner safe-area rectangle inset ~8% of the cell
size. Both colours sit in the magenta family the keyer already strips, so the guides vanish after
keying -- they steer the model without surviving into the final art.

Usage:
    python3 tools/make-template.py --sheet tiles
    python3 tools/make-template.py --sheet actors -o template-actors.png
    python3 tools/make-template.py --cells 6x4 --cell-size 160 -o custom-template.png

Requires Pillow (pip install pillow).
"""

from __future__ import annotations

import argparse
import sys

from PIL import Image

BACKGROUND = (255, 0, 255)
GUIDE = (240, 0, 240)
SAFE_AREA_INSET_FRACTION = 0.08

# All three sheet families use an 8x8 grid of 128px cells on a 1024x1024 canvas: see
# docs/design/tileset-generation.md and docs/design/actor-item-spritesheet-generation.md.
SHEET_PRESETS = {
    "tiles": {"cols": 8, "rows": 8, "cell_size": 128},
    "actors": {"cols": 8, "rows": 8, "cell_size": 128},
    "items": {"cols": 8, "rows": 8, "cell_size": 128},
}


def _is_magenta_family(pixel: tuple[int, int, int]) -> bool:
    """Return True if `pixel` is the background or guide colour (no other colour is allowed)."""
    return pixel == BACKGROUND or pixel == GUIDE


def draw_template(cols: int, rows: int, cell_size: int) -> Image.Image:
    """Return an RGB template: solid magenta background, near-magenta cell borders and inset
    safe-area rectangles, sized `cols * cell_size` x `rows * cell_size`."""
    width, height = cols * cell_size, rows * cell_size
    image = Image.new("RGB", (width, height), BACKGROUND)
    pixels = image.load()
    if pixels is None:
        raise RuntimeError("pixel access unavailable")

    # Full grid: 1px border lines at every cell boundary, including the outer edge.
    for gx in range(0, width + 1, cell_size):
        x = min(gx, width - 1)
        for y in range(height):
            pixels[x, y] = GUIDE
    for gy in range(0, height + 1, cell_size):
        y = min(gy, height - 1)
        for x in range(width):
            pixels[x, y] = GUIDE

    # Inner safe-area rectangle per cell, inset ~8% of the cell size on each side.
    inset = max(1, round(cell_size * SAFE_AREA_INSET_FRACTION))
    for row in range(rows):
        for col in range(cols):
            x0, y0 = col * cell_size + inset, row * cell_size + inset
            x1, y1 = col * cell_size + cell_size - 1 - inset, row * cell_size + cell_size - 1 - inset
            for x in range(x0, x1 + 1):
                pixels[x, y0] = GUIDE
                pixels[x, y1] = GUIDE
            for y in range(y0, y1 + 1):
                pixels[x0, y] = GUIDE
                pixels[x1, y] = GUIDE

    return image


def self_check(image: Image.Image, cols: int, rows: int, cell_size: int) -> list[str]:
    """Return a list of problems found, empty if the template is well-formed."""
    problems: list[str] = []
    width, height = cols * cell_size, rows * cell_size
    if image.size != (width, height):
        problems.append(f"size mismatch: expected {(width, height)}, got {image.size}")

    rgb = image.convert("RGB")
    pixels = rgb.load()
    if pixels is None:
        raise RuntimeError("pixel access unavailable")
    w, h = rgb.size

    def _pixel_at(x: int, y: int) -> tuple[int, int, int]:
        """Narrow PixelAccess's loose return type to a 3-tuple of ints for an RGB image."""
        value = pixels[x, y]
        if not isinstance(value, tuple) or len(value) != 3:
            raise RuntimeError(f"unexpected pixel value at ({x}, {y}): {value!r}")
        return value

    for y in range(h):
        for x in range(w):
            pixel = _pixel_at(x, y)
            if not _is_magenta_family(pixel):
                problems.append(f"non-magenta pixel at ({x}, {y}): {pixel}")
                return problems  # one report is enough; bail out early

    # Exact grid-line positions: every cell-boundary row/column must be entirely guide-coloured.
    for gx in range(0, w + 1, cell_size):
        x = min(gx, w - 1)
        if any(_pixel_at(x, y) != GUIDE for y in range(h)):
            problems.append(f"vertical grid line at x={x} is not solid guide colour")
            break
    for gy in range(0, h + 1, cell_size):
        y = min(gy, h - 1)
        if any(_pixel_at(x, y) != GUIDE for x in range(w)):
            problems.append(f"horizontal grid line at y={y} is not solid guide colour")
            break

    return problems


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--sheet",
        choices=sorted(SHEET_PRESETS),
        help="use a named preset's grid geometry (tiles/actors/items, all 8x8 @ 128px)",
    )
    parser.add_argument("--cells", help="override grid as COLSxROWS, e.g. 6x4")
    parser.add_argument("--cell-size", type=int, help="override cell size in px")
    parser.add_argument(
        "-o",
        "--output",
        help="destination PNG (default template-<sheet>.png, or template.png without --sheet)",
    )
    args = parser.parse_args(argv)

    if not args.sheet and not args.cells:
        parser.error("specify --sheet or --cells")

    if args.sheet:
        preset = SHEET_PRESETS[args.sheet]
        cols, rows, cell_size = preset["cols"], preset["rows"], preset["cell_size"]
    else:
        cols, rows, cell_size = 8, 8, 128

    if args.cells:
        try:
            cols_str, rows_str = args.cells.lower().split("x", 1)
            cols, rows = int(cols_str), int(rows_str)
        except ValueError:
            parser.error("--cells must be COLSxROWS, e.g. 6x4")
    if args.cell_size:
        cell_size = args.cell_size

    if cols <= 0 or rows <= 0 or cell_size <= 0:
        parser.error("cols, rows, and cell-size must all be positive")

    if args.output:
        output = args.output
    elif args.sheet:
        output = f"template-{args.sheet}.png"
    else:
        output = "template.png"

    image = draw_template(cols, rows, cell_size)
    image.save(output)

    with Image.open(output) as reopened:
        reopened.load()
        problems = self_check(reopened, cols, rows, cell_size)
    if problems:
        for problem in problems[:10]:
            print(f"self-check failed: {problem}", file=sys.stderr)
        return 1

    print(f"wrote {output} ({cols}x{rows} cells @ {cell_size}px, {image.size[0]}x{image.size[1]})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
