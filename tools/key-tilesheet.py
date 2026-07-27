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


def _defringe(rgba: np.ndarray, tolerance: float) -> None:
    """Damp the coloured halo on art pixels that border a now-transparent pixel, in place.

    A surviving edge pixel next to keyed transparency carries a magenta cast; lift its green toward
    the red/blue mean to neutralise the tint and drop its alpha in proportion to how tinted it
    remains, so the art edge fades cleanly rather than ending on a pink rim.
    """
    r, g, b = rgba[..., 0], rgba[..., 1], rgba[..., 2]
    keyed = rgba[..., 3] == 0
    neigh = np.zeros_like(keyed)
    neigh[1:, :] |= keyed[:-1, :]
    neigh[:-1, :] |= keyed[1:, :]
    neigh[:, 1:] |= keyed[:, :-1]
    neigh[:, :-1] |= keyed[:, 1:]
    fringe = neigh & (~keyed)

    magenta_amount = np.clip((r + b) / 2.0 - g, 0, None)
    edge = fringe & (magenta_amount > 8)
    target_g = (r + b) / 2.0
    # Lift green most of the way to the red/blue mean (0.85) so a heavy magenta rim collapses to
    # near-neutral rather than staying visibly pink, and fade the most-tinted edge pixels toward
    # transparency (floor 0.2) since they are bleed, not art.
    rgba[..., 1] = np.where(edge, g + (target_g - g) * 0.85, g)
    edge_alpha = np.clip(1.0 - (magenta_amount - 8) / (tolerance * 0.67), 0.2, 1.0)
    rgba[..., 3] = np.where(edge, rgba[..., 3] * edge_alpha, rgba[..., 3])


def key_tilesheet(src: Image.Image, tolerance: float) -> Image.Image:
    """Return an RGBA copy of `src` with its magenta and per-cell backdrops keyed to transparency."""
    rgba = np.asarray(src.convert("RGBA")).astype(np.float32)
    _magenta_key(rgba, tolerance)
    _flood_cells(rgba, tolerance)
    _defringe(rgba, tolerance)
    return Image.fromarray(np.clip(rgba, 0, 255).astype(np.uint8), "RGBA")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("input", help="source PNG with a solid magenta background")
    parser.add_argument("output", help="destination PNG (may equal input to overwrite)")
    parser.add_argument(
        "--tolerance",
        type=float,
        default=60.0,
        help="colour-distance threshold for the key and per-cell flood (default 60)",
    )
    args = parser.parse_args(argv)

    with Image.open(args.input) as src:
        result = key_tilesheet(src, args.tolerance)
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
