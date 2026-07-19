import { useEffect, useRef, useState, type RefObject } from 'react';
import type { GameplayProjection } from '@woven-deep/engine';
import { zoomForFloor, type ZoomFactor } from '../layout.js';

const FALLBACK_CELL_PX = { width: 8, height: 16 };

type PixelSize = Readonly<{ width: number; height: number }>;

export interface PaneMeasurement {
  readonly mapPaneRef: RefObject<HTMLDivElement | null>;
  readonly cellProbeRef: RefObject<HTMLSpanElement | null>;
  readonly cellProbeBaseRef: RefObject<HTMLSpanElement | null>;
  readonly paneSize: PixelSize;
  readonly cellSize: PixelSize;
  readonly zoom: ZoomFactor;
}

/**
 * Owns the two pieces of layout state that cannot live in a pure module — the measured pane/cell
 * pixel sizes and the per-floor zoom — plus the refs and ResizeObserver wiring that keep them in
 * sync with what is actually on screen. The viewport arithmetic and camera formula are left to the
 * pure functions in `layout.ts`/`camera.ts`, so those stay unit-testable without a DOM.
 */
export function usePaneMeasurement(floor: GameplayProjection['floor']): PaneMeasurement {
  const mapPaneRef = useRef<HTMLDivElement>(null);
  const cellProbeRef = useRef<HTMLSpanElement>(null);
  // A second, un-zoomed probe (fixed at the base font-size, see `.cell-probe-base` in styles.css)
  // used only to feed `zoomForFloor` the 1x cell size — see the effect below for why this is a
  // second measured element rather than dividing `cellProbeRef`'s zoomed measurement by the
  // applied zoom.
  const cellProbeBaseRef = useRef<HTMLSpanElement>(null);
  const [paneSize, setPaneSize] = useState({ width: 0, height: 0 });
  const [cellSize, setCellSize] = useState<PixelSize>(FALLBACK_CELL_PX);
  const [zoom, setZoom] = useState<ZoomFactor>(1);
  // Mirrors `zoom` state but read synchronously inside the measure callback below (which closes
  // over it once per floor, via the `floorId`-keyed effect), so the callback can compare against
  // the zoom actually applied to the DOM right now without adding `zoom` to that effect's own
  // dependency array (which would tear down/re-attach the pane observer on every zoom change).
  const zoomRef = useRef<ZoomFactor>(1);

  // The map pane observer feeds `viewportForPane` (cell math for the camera/grid) and the zoom
  // decision. Re-runs (tearing down and re-attaching the observer, then measuring immediately)
  // whenever the floor identity changes, not only on a real resize:
  // `zoomForFloor`'s answer depends on the floor's own dimensions (a 34x16 town and a 160x50
  // dungeon floor pick very different zooms in the same pane), and descending/ascending stairs
  // does not itself fire a ResizeObserver notification, so without this dependency the zoom
  // chosen for the PREVIOUS floor would silently keep applying to the new one.
  useEffect(() => {
    const node = mapPaneRef.current;
    if (!node) return undefined;
    const measure = (): void => {
      const paneRect = node.getBoundingClientRect();
      setPaneSize({ width: paneRect.width, height: paneRect.height });
      // `cellProbeRef` reports the CURRENTLY zoomed cell size — this is what the grid/effects
      // layer/popover math are actually rendered at, so it feeds `cellSize` directly.
      const cellRect = cellProbeRef.current?.getBoundingClientRect();
      if (cellRect && cellRect.width > 0 && cellRect.height > 0) {
        setCellSize({ width: cellRect.width, height: cellRect.height });
      }
      // `cellProbeBaseRef` is pinned to the base (1x) font-size regardless of the applied zoom
      // (see `.cell-probe-base` in styles.css), so it reports the 1x cell size `zoomForFloor`
      // needs directly — no algebra recovering it from the zoomed measurement, which would assume
      // font metrics scale perfectly linearly across font-sizes (they don't always, due to
      // hinting/subpixel rounding).
      const baseCellRect = cellProbeBaseRef.current?.getBoundingClientRect();
      if (baseCellRect && baseCellRect.width > 0 && baseCellRect.height > 0) {
        const baseCellPx = { width: baseCellRect.width, height: baseCellRect.height };
        const nextZoom = zoomForFloor({ panePx: paneRect, cellPx: baseCellPx, floor });
        if (nextZoom !== zoomRef.current) {
          zoomRef.current = nextZoom;
          setZoom(nextZoom);
        }
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [floor.floorId]);

  // Applying `--zoom` (on `.playfield`) changes the probe's OWN box size (it is pinned to
  // `var(--cell-w)`/`var(--cell-h)`, see styles.css), but that never changes the map pane's own
  // box size, so the ResizeObserver above — which only watches the pane — does not re-fire. This
  // effect re-measures the probe specifically after a zoom change lands, so `cellSize` (read by
  // `viewportForPane` and the popover pixel math) always reflects what is actually on screen.
  useEffect(() => {
    const cellRect = cellProbeRef.current?.getBoundingClientRect();
    if (cellRect && cellRect.width > 0 && cellRect.height > 0) {
      setCellSize({ width: cellRect.width, height: cellRect.height });
    }
  }, [zoom]);

  return { mapPaneRef, cellProbeRef, cellProbeBaseRef, paneSize, cellSize, zoom };
}
