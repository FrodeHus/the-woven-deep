#!/usr/bin/env python3
"""Measure tile rects from an alpha-keyed tilesheet whose blocks do not sit on a strict grid.

The strict-grid import path (`docs/design/tileset-generation.md`) slices a sheet as
`[c*128, r*128, 128, 128]`. A hand-laid sheet -- uneven per-row counts, blocks centred inside cells
on a non-128 pitch -- cannot be sliced that way without guillotining apexes. This tool measures the
art instead: it finds connected opaque components, merges fragments that belong to the same tile,
computes tight bounding boxes, and sorts them into rows (by centre-y) and columns (by centre-x).

It prints a row/col -> bbox table so an atlas can be authored from measured rects. It is deliberately
content-agnostic: it does not know which tile is which, only where each blob sits.

Requires Pillow and numpy. scipy is NOT required -- labeling uses an iterative flood (union by BFS).

Usage:
    python3 tools/slice-tilesheet.py apps/web/public/playfield/tiles.png out-atlas.json
    python3 tools/slice-tilesheet.py in.png out.json --alpha 16 --merge-gap 8 --min-area 200
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import deque

import numpy as np
from PIL import Image


def _label_components(mask: np.ndarray) -> tuple[np.ndarray, int]:
    """Label 8-connected components of a boolean mask with an iterative BFS (no scipy).

    Returns `(labels, count)` where `labels` is an int array (0 = background, 1..count = components).
    """
    h, w = mask.shape
    labels = np.zeros((h, w), dtype=np.int32)
    neighbours = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
    current = 0
    for sy in range(h):
        for sx in range(w):
            if not mask[sy, sx] or labels[sy, sx] != 0:
                continue
            current += 1
            labels[sy, sx] = current
            queue = deque([(sy, sx)])
            while queue:
                cy, cx = queue.popleft()
                for dy, dx in neighbours:
                    ny, nx = cy + dy, cx + dx
                    if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and labels[ny, nx] == 0:
                        labels[ny, nx] = current
                        queue.append((ny, nx))
    return labels, current


class _Box:
    """A mutable axis-aligned bounding box accumulating pixel extents and area."""

    __slots__ = ("x0", "y0", "x1", "y1", "area")

    def __init__(self, x0: int, y0: int, x1: int, y1: int, area: int) -> None:
        self.x0, self.y0, self.x1, self.y1, self.area = x0, y0, x1, y1, area

    def merge(self, other: "_Box") -> None:
        self.x0 = min(self.x0, other.x0)
        self.y0 = min(self.y0, other.y0)
        self.x1 = max(self.x1, other.x1)
        self.y1 = max(self.y1, other.y1)
        self.area += other.area

    def gap_to(self, other: "_Box") -> float:
        """Rectangle-to-rectangle gap: 0 if the boxes touch/overlap, else the nearest-edge distance."""
        dx = max(0, max(self.x0 - other.x1, other.x0 - self.x1))
        dy = max(0, max(self.y0 - other.y1, other.y0 - self.y1))
        return max(dx, dy)

    @property
    def cx(self) -> float:
        return (self.x0 + self.x1) / 2.0

    @property
    def cy(self) -> float:
        return (self.y0 + self.y1) / 2.0

    def rect(self) -> list[int]:
        """[x, y, w, h] with w/h as inclusive pixel spans."""
        return [self.x0, self.y0, self.x1 - self.x0 + 1, self.y1 - self.y0 + 1]


def _boxes_from_labels(labels: np.ndarray, count: int, min_area: int) -> list[_Box]:
    boxes: list[_Box] = []
    for label in range(1, count + 1):
        ys, xs = np.where(labels == label)
        area = int(xs.size)
        if area < min_area:
            continue
        boxes.append(_Box(int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max()), area))
    return boxes


def _merge_close(boxes: list[_Box], merge_gap: float) -> list[_Box]:
    """Union boxes whose nearest-edge gap is below `merge_gap` (anti-aliased fragments, detached
    highlights) until no further merge is possible."""
    merged = True
    while merged:
        merged = False
        result: list[_Box] = []
        for box in boxes:
            for existing in result:
                if existing.gap_to(box) < merge_gap:
                    existing.merge(box)
                    merged = True
                    break
            else:
                result.append(box)
        boxes = result
    return boxes


def _cluster_rows(boxes: list[_Box], row_gap: float) -> list[list[_Box]]:
    """Group boxes into rows by centre-y: a new row starts when the vertical gap to the previous
    box's centre exceeds `row_gap`. Rows are returned top-to-bottom, each sorted left-to-right."""
    ordered = sorted(boxes, key=lambda b: b.cy)
    rows: list[list[_Box]] = []
    for box in ordered:
        if rows and box.cy - rows[-1][-1].cy <= row_gap:
            rows[-1].append(box)
        else:
            rows.append([box])
    for row in rows:
        row.sort(key=lambda b: b.cx)
    return rows


def slice_sheet(
    image: Image.Image,
    alpha: int,
    merge_gap: float,
    min_area: int,
    row_gap: float,
) -> list[list[_Box]]:
    """Return the measured blobs grouped into rows (top-to-bottom), each sorted left-to-right."""
    rgba = np.asarray(image.convert("RGBA"))
    mask = rgba[..., 3] > alpha
    labels, count = _label_components(mask)
    boxes = _boxes_from_labels(labels, count, min_area)
    boxes = _merge_close(boxes, merge_gap)
    return _cluster_rows(boxes, row_gap)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("input", help="alpha-keyed source PNG (run key-tilesheet.py first)")
    parser.add_argument("output", help="destination JSON: measured rows of [x, y, w, h] rects")
    parser.add_argument("--alpha", type=int, default=16, help="opacity threshold (default 16)")
    parser.add_argument(
        "--merge-gap",
        type=float,
        default=8.0,
        help="merge fragments whose nearest-edge gap is below this many px (default 8)",
    )
    parser.add_argument(
        "--min-area",
        type=int,
        default=200,
        help="drop components smaller than this many opaque px as noise (default 200)",
    )
    parser.add_argument(
        "--row-gap",
        type=float,
        default=60.0,
        help="centre-y gap that starts a new row (default 60)",
    )
    args = parser.parse_args(argv)

    with Image.open(args.input) as src:
        rows = slice_sheet(src, args.alpha, args.merge_gap, args.min_area, args.row_gap)

    table = [[box.rect() for box in row] for row in rows]
    with open(args.output, "w", encoding="utf-8") as handle:
        json.dump({"image": args.input, "rows": table}, handle, indent=2)
        handle.write("\n")

    print(f"sliced {args.input}: {len(rows)} rows", file=sys.stderr)
    for r, row in enumerate(rows):
        cells = "  ".join(f"c{c}={box.rect()}" for c, box in enumerate(row))
        print(f"row {r} ({len(row)} items): {cells}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
