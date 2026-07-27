#!/usr/bin/env python3
"""Chroma-key a generated tilesheet: make its solid magenta background transparent.

Image generators cannot emit an alpha channel, so tilesheets are authored with a solid magenta
(#ff00ff-ish) background wherever art is absent. This tool produces the transparency the renderer
needs: it samples the background colour from the corners, keys every pixel within a tolerance of it
(guarding g < r and g < b so only magenta is removed, never legitimate warm or violet art), and
de-fringes the surviving edge pixels so no pink halo is left around the art.

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


def key_tilesheet(src: Image.Image, tolerance: float) -> Image.Image:
    """Return an RGBA copy of `src` with its magenta background keyed to transparency."""
    rgba = np.asarray(src.convert("RGBA")).astype(np.float32)
    r, g, b = rgba[..., 0], rgba[..., 1], rgba[..., 2]

    # Reference background colour: the mean of the four corner pixels. On a machine-sliced sheet
    # the corners are always background, and averaging absorbs the generator's compression noise.
    corners = np.stack(
        [rgba[0, 0, :3], rgba[0, -1, :3], rgba[-1, 0, :3], rgba[-1, -1, :3]]
    )
    ref = corners.mean(axis=0)

    dist = np.sqrt((r - ref[0]) ** 2 + (g - ref[1]) ** 2 + (b - ref[2]) ** 2)
    # Magenta guard: the background's green channel sits well below both red and blue. Warm stone
    # (g high) and violet Weave art (g between r and b) never satisfy this, so they are preserved.
    is_bg = (dist < tolerance) & (g < r) & (g < b)

    out = rgba.copy()

    # De-fringe: a surviving pixel that borders a keyed pixel carries a magenta halo. Damp the
    # magenta cast (lift green toward the red/blue mean) and drop alpha in proportion to how
    # magenta-tinted it still is, so the art's edge fades cleanly into full transparency.
    neigh = np.zeros_like(is_bg)
    neigh[1:, :] |= is_bg[:-1, :]
    neigh[:-1, :] |= is_bg[1:, :]
    neigh[:, 1:] |= is_bg[:, :-1]
    neigh[:, :-1] |= is_bg[:, 1:]
    fringe = neigh & (~is_bg)

    magenta_amount = np.clip((r + b) / 2.0 - g, 0, None)
    edge = fringe & (magenta_amount > 8)
    target_g = (r + b) / 2.0
    out[..., 1] = np.where(edge, g + (target_g - g) * 0.6, g)
    edge_alpha = np.clip(1.0 - (magenta_amount - 8) / tolerance, 0.35, 1.0)
    out[..., 3] = np.where(edge, out[..., 3] * edge_alpha, out[..., 3])

    # Fully clear the keyed background last so the de-fringe pass never reads an already-zeroed row.
    out[..., 3] = np.where(is_bg, 0, out[..., 3])

    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGBA")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("input", help="source PNG with a solid magenta background")
    parser.add_argument("output", help="destination PNG (may equal input to overwrite)")
    parser.add_argument(
        "--tolerance",
        type=float,
        default=60.0,
        help="colour-distance threshold for the key (default 60; raise for noisier sheets)",
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
