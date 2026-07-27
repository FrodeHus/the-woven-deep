#!/usr/bin/env python3
"""Chroma-key a generated tilesheet: make its background transparent.

Image generators cannot emit an alpha channel, so tilesheets are authored with a solid magenta
(#ff00ff-ish) background wherever art is absent. Some generators also leave an opaque flat backdrop
(grey or a darkened magenta) behind individual object tiles, which the magenta guard rightly refuses
to key -- it would render as a solid box in-game. This tool produces the transparency the renderer
needs in two passes:

1. A GLOBAL magenta key: every pixel within `--tolerance` of the corner background colour, guarded
   by `g < r and g < b` so only magenta is removed, never warm stone or violet Weave art.
2. A PER-CELL flood-fill: for each 128px cell, flood inward from the four cell corners over the
   connected region whose colour stays near-uniform with the corner (both leftover magenta and any
   flat grey backdrop qualify). Only regions CONNECTED to a corner are cleared, so centred object
   art -- walled off by its own silhouette edge -- is never touched.

Both passes leave the art edges de-fringed so no coloured halo survives.

Usage:
    python3 tools/key-tilesheet.py in.png apps/web/public/playfield/tiles.png
    python3 tools/key-tilesheet.py in.png out.png --tolerance 70

Requires Pillow and numpy (pip install pillow numpy).
"""

from __future__ import annotations

import argparse
import sys

import numpy as np
from PIL import Image

CELL = 128


def _magenta_key(rgba: np.ndarray, tolerance: float) -> None:
    """Set alpha 0 on every pixel within `tolerance` of the corner magenta, in place."""
    r, g, b = rgba[..., 0], rgba[..., 1], rgba[..., 2]
    corners = np.stack([rgba[0, 0, :3], rgba[0, -1, :3], rgba[-1, 0, :3], rgba[-1, -1, :3]])
    ref = corners.mean(axis=0)
    dist = np.sqrt((r - ref[0]) ** 2 + (g - ref[1]) ** 2 + (b - ref[2]) ** 2)
    # Magenta guard: the background's green channel sits well below both red and blue. Warm stone
    # (g high) and violet Weave art (g between r and b) never satisfy this, so they are preserved.
    is_bg = (dist < tolerance) & (g < r) & (g < b)
    rgba[..., 3] = np.where(is_bg, 0, rgba[..., 3])


def _flood_cell(cell: np.ndarray, tolerance: float) -> None:
    """Clear the backdrop connected to a single cell's corners, in place.

    Seeds a flood at the four corners and expands over `passable` pixels -- those already
    transparent, or opaque but within `tolerance` of a corner's colour. Opaque pixels the flood
    reaches are the backdrop and are set transparent; interior art, fenced off by its silhouette
    edge (which is outside the tolerance band), is unreachable and survives.
    """
    alpha = cell[..., 3]
    rgb = cell[..., :3].astype(np.float32)
    h, w = alpha.shape
    corners = [(0, 0), (0, w - 1), (h - 1, 0), (h - 1, w - 1)]

    passable = alpha == 0
    reached = np.zeros((h, w), dtype=bool)
    for cy, cx in corners:
        ref = rgb[cy, cx]
        near = np.sqrt(((rgb - ref) ** 2).sum(axis=2)) <= tolerance
        passable |= near
        reached[cy, cx] = True

    # 4-neighbour flood by iterative dilation, clamped to the passable set, until it stops growing.
    while True:
        grown = reached.copy()
        grown[1:, :] |= reached[:-1, :]
        grown[:-1, :] |= reached[1:, :]
        grown[:, 1:] |= reached[:, :-1]
        grown[:, :-1] |= reached[:, 1:]
        grown &= passable
        if np.array_equal(grown, reached):
            break
        reached = grown

    alpha[reached & (alpha > 0)] = 0


def _flood_cells(rgba: np.ndarray, tolerance: float) -> None:
    """Run the per-cell corner flood over every 128px cell of the sheet, in place."""
    h, w = rgba.shape[:2]
    for cy in range(0, h, CELL):
        for cx in range(0, w, CELL):
            _flood_cell(rgba[cy : cy + CELL, cx : cx + CELL], tolerance)


def _defringe(rgba: np.ndarray) -> None:
    """Damp the coloured halo on art pixels that border a now-transparent pixel, in place.

    A surviving edge pixel next to the keyed background carries a magenta cast. The isometric floor
    diamonds span their whole cell, so their edges sit against a thin anti-aliased rim (partial
    alpha) rather than hard zero-alpha transparency; treating any pixel below `RIM_ALPHA` as the
    boundary and reaching two rings inward catches the fully-opaque magenta the earlier passes leave
    on those diagonal edges. For every reached art pixel with a magenta cast the green channel is
    lifted to the red/blue mean, collapsing the violet seam to neutral stone, and the tinted rim
    pixels themselves fade toward transparency since they are background bleed, not art. Interior art
    (the luminous violet Weave-conduit threads across wall faces) never borders the boundary, so it
    is untouched.
    """
    RIM_ALPHA = 200
    r, g, b = rgba[..., 0], rgba[..., 1], rgba[..., 2]
    alpha = rgba[..., 3]

    boundary = alpha < RIM_ALPHA
    reached = boundary.copy()
    for _ in range(2):
        grown = reached.copy()
        grown[1:, :] |= reached[:-1, :]
        grown[:-1, :] |= reached[1:, :]
        grown[:, 1:] |= reached[:, :-1]
        grown[:, :-1] |= reached[:, 1:]
        reached = grown
    near_boundary = reached & (alpha > 0)

    magenta_amount = np.clip((r + b) / 2.0 - g, 0, None)
    edge = near_boundary & (magenta_amount > 6)
    target_g = (r + b) / 2.0
    rgba[..., 1] = np.where(edge, target_g, g)
    # Fade the strongly-tinted rim pixels (still translucent) toward transparency; keep opaque art
    # pixels opaque once their green is neutralised.
    rim_bleed = edge & boundary & (magenta_amount > 30)
    rgba[..., 3] = np.where(rim_bleed, 0, alpha)


def key_tilesheet(src: Image.Image, tolerance: float, defringe_only: bool = False) -> Image.Image:
    """Return an RGBA copy of `src` with its magenta and per-cell backdrops keyed to transparency.

    With `defringe_only` the magenta-key and per-cell flood passes are skipped -- they need the solid
    magenta background of an unkeyed source -- and only the de-fringe runs, neutralising the violet
    seams left on an already-keyed sheet.
    """
    rgba = np.asarray(src.convert("RGBA")).astype(np.float32)
    if not defringe_only:
        _magenta_key(rgba, tolerance)
        _flood_cells(rgba, tolerance)
    _defringe(rgba)
    return Image.fromarray(np.clip(rgba, 0, 255).astype(np.uint8), "RGBA")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("input", help="source PNG with a solid magenta background")
    parser.add_argument("output", help="destination PNG (may equal input to overwrite)")
    parser.add_argument(
        "--tolerance",
        type=float,
        default=60.0,
        help="colour-distance threshold for the magenta keying pass only (default 60)",
    )
    parser.add_argument(
        "--defringe-only",
        action="store_true",
        help="skip the magenta key and flood (they need an unkeyed source) and only de-fringe an "
        "already-keyed RGBA sheet",
    )
    args = parser.parse_args(argv)

    with Image.open(args.input) as src:
        result = key_tilesheet(src, args.tolerance, defringe_only=args.defringe_only)
    result.save(args.output)

    keyed = np.asarray(result)[..., 3]
    corner_alpha = [int(keyed[0, 0]), int(keyed[0, -1]), int(keyed[-1, 0]), int(keyed[-1, -1])]
    if any(corner_alpha):
        print(
            f"warning: corners not fully transparent {corner_alpha}; "
            "raise --tolerance or check the background colour",
            file=sys.stderr,
        )
    transparent_fraction = float((keyed == 0).mean())
    print(f"keyed {args.input} -> {args.output} ({transparent_fraction:.0%} transparent)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
