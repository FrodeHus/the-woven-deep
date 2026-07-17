import { useEffect, useRef, type JSX } from 'react';
import type { CompiledContentPack } from '@woven-deep/content';
import type { GameplayProjection } from '@woven-deep/engine';
import { TILE_DEFINITIONS } from '@woven-deep/engine';
import type { CameraOrigin, CameraViewport } from './camera.js';
import { visibilityPolygon, type LightOccluder } from './light-geometry.js';
import { equippedLightSource, fixtureLightsFor } from './light-sources.js';
import type { Settings } from '../session/settings.js';

export interface LightCanvasProps {
  readonly projection: GameplayProjection;
  readonly pack: CompiledContentPack;
  readonly camera: CameraOrigin;
  readonly viewport: CameraViewport;
  /** The CURRENTLY rendered (zoomed) cell size in CSS pixels -- the same measurement
   * `PlayScreen` feeds `GridRenderer`/`ThreatPopover`, so the canvas always matches what's
   * actually on screen at the current zoom, with no separate arithmetic to drift. */
  readonly cellSize: Readonly<{ width: number; height: number }>;
  /** Only `settings.lighting` matters here -- accepting the narrower type (rather than the full
   * `Settings`) keeps this component's surface honest about what it actually reads. */
  readonly lighting: Settings['lighting'];
}

interface LightSourceInput {
  readonly x: number;
  readonly y: number;
  readonly color: readonly [number, number, number];
  readonly radius: number;
  /** 0-255 authored peak brightness (an item's or a fixture's `light.strength`). */
  readonly strength: number;
  /** Multiplies peak alpha further -- the hero's remaining fuel fraction; always 1 for a fixture
   * (fixtures have no fuel to deplete). */
  readonly dimming: number;
}

/** Peak alpha for a light's gradient center: `strength` (0-255) normalized to 0-1, then further
 * scaled by `dimming` (fuel fraction for the hero's carried light, 1 for a fixture). Clamped so a
 * corrupt/out-of-range authored value can never invert into a negative or over-bright alpha. */
function peakAlpha(source: LightSourceInput): number {
  return Math.max(0, Math.min(1, (source.strength / 255) * source.dimming));
}

/** Half-width (in CSS px) of the soft-rim blur pass -- large enough to read as a gentle falloff at
 * the polygon's silhouette edge, small enough not to visibly haze the whole scene. */
const RIM_BLUR_PX = 5;
/** The rim pass's peak alpha, as a fraction of the main pass's -- a faint halo, not a second full
 * light. */
const RIM_ALPHA_FACTOR = 0.3;
/** The main gradient's midpoint color-stop position (fraction of radius) and its alpha fraction of
 * peak -- an extra stop between full-peak-at-center and zero-at-edge so the falloff reads as a
 * smooth glow rather than a sharp two-stop cone. */
const MID_STOP_POSITION = 0.6;
const MID_STOP_ALPHA_FACTOR = 0.5;

/** Terrain `tileId`s that occlude light -- derived from the engine's own `TILE_DEFINITIONS`
 * (`opaque` flag), never a hand-maintained id list, so this can never silently drift from what the
 * engine itself considers opaque (wall/closed-door/pillar/void, ids 0/2/3/6 today). */
const OPAQUE_TILE_IDS: ReadonlySet<number> = new Set(
  TILE_DEFINITIONS.filter((definition) => definition.opaque).map((definition) => definition.id),
);

/**
 * Every explored (non-`unknown`) opaque cell within `radius` cells of `origin`, in the plain
 * `{x, y}` shape `visibilityPolygon` expects. An `unknown` cell carries no `tileId` at all (see
 * `ObservableCell`), so it can never match `OPAQUE_TILE_IDS` and is never treated as occluding --
 * exactly right, since a cell the hero has never seen is outside their perception regardless of
 * what actually occupies it.
 */
function occludersNear(
  floor: GameplayProjection['floor'], origin: Readonly<{ x: number; y: number }>, radius: number,
): readonly LightOccluder[] {
  const minX = Math.max(0, Math.floor(origin.x - radius));
  const maxX = Math.min(floor.width - 1, Math.ceil(origin.x + radius));
  const minY = Math.max(0, Math.floor(origin.y - radius));
  const maxY = Math.min(floor.height - 1, Math.ceil(origin.y + radius));

  const occluders: LightOccluder[] = [];
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const cell = floor.cells[y * floor.width + x];
      if (cell?.tileId !== undefined && OPAQUE_TILE_IDS.has(cell.tileId)) occluders.push({ x, y });
    }
  }
  return occluders;
}

/** Feature-detects a real canvas 2D context WITHOUT ever mounting a `<canvas>` into the DOM --
 * jsdom (our test environment) and any browser without canvas support both return `null` from
 * `getContext('2d')` on a bare, unattached element, so this is a safe, side-effect-free probe.
 * Exported so `PlayScreen` can apply the `.lighting-smooth` playfield class in lockstep with
 * whether `LightCanvas` is ACTUALLY going to render a canvas -- the CSS brightness-flattening it
 * enables would look wrong (flat, with no falloff at all) if applied while the canvas itself has
 * silently fallen back to rendering nothing. */
export function canvas2dAvailable(): boolean {
  try {
    return document.createElement('canvas').getContext('2d') !== null;
  } catch {
    return false;
  }
}

/** Traces `polygon` (cell-space coordinates) as the CURRENT path on `ctx`, mapped through
 * `toScreenX`/`toScreenY` -- plain `beginPath`/`moveTo`/`lineTo`/`closePath` rather than a
 * `Path2D` object, deliberately: `Path2D` isn't implemented in jsdom (this project's test
 * environment), and a mocked 2D context in a component test is far simpler to assert against when
 * `fill()` takes no argument and just uses whatever path was last traced. */
function tracePolygonPath(
  ctx: CanvasRenderingContext2D,
  polygon: readonly (readonly [number, number])[],
  toScreenX: (worldX: number) => number,
  toScreenY: (worldY: number) => number,
): void {
  ctx.beginPath();
  const [firstX, firstY] = polygon[0]!;
  ctx.moveTo(toScreenX(firstX), toScreenY(firstY));
  for (let index = 1; index < polygon.length; index += 1) {
    const [vx, vy] = polygon[index]!;
    ctx.lineTo(toScreenX(vx), toScreenY(vy));
  }
  ctx.closePath();
}

/** Draws one light source's visibility-polygon gradient onto `ctx`, in already-composited CSS
 * pixel space (the caller has applied the device-pixel-ratio transform). Two passes, both under
 * the caller's `globalCompositeOperation: 'lighter'`: a blurred, low-alpha "rim" pass first (so
 * its haze sits BEHIND the crisp core), then the full-alpha core gradient. */
function drawSource(
  ctx: CanvasRenderingContext2D,
  source: LightSourceInput,
  camera: CameraOrigin,
  cellSize: Readonly<{ width: number; height: number }>,
  occluders: readonly LightOccluder[],
): void {
  const alpha = peakAlpha(source);
  if (alpha <= 0) return;

  // Origin at the light's cell CENTER (not its top-left corner) so the glow radiates symmetrically
  // from the middle of the cell it occupies -- `visibilityPolygon`'s occluder squares stay in the
  // corner-aligned unit-cell convention documented in `light-geometry.ts`; only the origin moves.
  const originX = source.x + 0.5;
  const originY = source.y + 0.5;
  const polygon = visibilityPolygon({ origin: { x: originX, y: originY }, radius: source.radius, occluders });
  if (polygon.length === 0) return;

  const toScreenX = (worldX: number): number => (worldX - camera.x) * cellSize.width;
  const toScreenY = (worldY: number): number => (worldY - camera.y) * cellSize.height;

  const cx = toScreenX(originX);
  const cy = toScreenY(originY);
  // Radius in px along the wider of the two cell axes so the gradient reaches the polygon's
  // farthest vertices regardless of aspect ratio (cells are usually taller than wide).
  const radiusPx = source.radius * Math.max(cellSize.width, cellSize.height);
  const [r, g, b] = source.color;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  ctx.save();
  ctx.filter = `blur(${RIM_BLUR_PX}px)`;
  const rim = ctx.createRadialGradient(cx, cy, 0, cx, cy, radiusPx);
  rim.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${alpha * RIM_ALPHA_FACTOR})`);
  rim.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
  ctx.fillStyle = rim;
  tracePolygonPath(ctx, polygon, toScreenX, toScreenY);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.filter = 'none';
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, radiusPx);
  core.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${alpha})`);
  core.addColorStop(MID_STOP_POSITION, `rgba(${r}, ${g}, ${b}, ${alpha * MID_STOP_ALPHA_FACTOR})`);
  core.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
  ctx.fillStyle = core;
  tracePolygonPath(ctx, polygon, toScreenX, toScreenY);
  ctx.fill();
  ctx.restore();

  ctx.restore();
}

/**
 * The visibility-polygon light layer (Task 6): one `<canvas>` slotted into `.playfield` BEFORE
 * `.playfield-grid` (see `styles.css`'s note on why that slot was reserved), painting a soft
 * radial-gradient glow, shadow-cast against explored opaque terrain, for every currently-visible
 * light source the client can identify -- the hero's carried light plus every visible vault
 * fixture (`light-sources.ts`).
 *
 * `settings.lighting === 'classic'` renders nothing at all (today's CSS-only lighting, unchanged).
 * `'smooth'` renders the canvas UNLESS a real 2D context isn't available (jsdom, an ancient
 * browser) -- that falls back to the same "render nothing" behavior automatically, logging a
 * single low-severity breadcrumb (not a warning/error: a missing canvas is an expected, handled
 * fallback, not a bug) the first time it happens.
 *
 * Purely decorative: `aria-hidden`, `pointer-events: none`, never read by any gameplay logic --
 * the engine's per-cell `intensity`/`tint` remain the sole gameplay/perception authority.
 */
export function LightCanvas({ projection, pack, camera, viewport, cellSize, lighting }: LightCanvasProps): JSX.Element | null {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const availableRef = useRef<boolean | null>(null);
  if (availableRef.current === null) availableRef.current = canvas2dAvailable();
  const available = availableRef.current;

  // Runs once per mount (stable deps under normal use) -- logs the fallback breadcrumb exactly
  // once per `LightCanvas` instance rather than on every render.
  useEffect(() => {
    if (lighting === 'smooth' && !available) {
      // eslint-disable-next-line no-console -- an intentional, low-severity breadcrumb: canvas
      // lighting is unavailable and the classic fallback has taken over silently for the player.
      console.debug('[LightCanvas] canvas 2D unavailable; falling back to classic lighting');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally mount-only.
  }, []);

  const render = lighting === 'smooth' && available;

  useEffect(() => {
    if (!render) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const cssWidth = Math.max(1, viewport.width * cellSize.width);
    const cssHeight = Math.max(1, viewport.height * cellSize.height);
    canvas.width = Math.max(1, Math.round(cssWidth * dpr));
    canvas.height = Math.max(1, Math.round(cssHeight * dpr));
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    const hero = equippedLightSource(projection, pack);
    const heroPosition = projection.hero as unknown as { x: number; y: number };
    const sources: LightSourceInput[] = [];
    if (hero) {
      sources.push({
        x: heroPosition.x, y: heroPosition.y, color: hero.color, radius: hero.radius,
        strength: hero.strength, dimming: hero.fuelFraction,
      });
    }
    for (const fixture of fixtureLightsFor(projection, pack)) {
      sources.push({
        x: fixture.x, y: fixture.y, color: fixture.color, radius: fixture.radius,
        strength: fixture.strength, dimming: 1,
      });
    }

    for (const source of sources) {
      const occluders = occludersNear(projection.floor, source, source.radius);
      drawSource(ctx, source, camera, cellSize, occluders);
    }
  }, [projection, pack, camera, viewport, cellSize, render]);

  if (!render) return null;

  return <canvas ref={canvasRef} aria-hidden="true" className="light-canvas" />;
}
