import type { ObservableCell } from '@woven-deep/engine';
import { TILE_HALF_W } from './iso-math.js';

/**
 * Pure inputs for the renderer's light layer. Everything the `IsoRenderer` needs to paint a light
 * pool -- position (in grid cells), reach (`radius`, in cells), base `intensity` (0..1), and a
 * `flickerSeed` phase offset -- lives here so the class stays a thin composition root with no
 * light-placement logic of its own.
 */
export interface LightSpec {
  x: number;
  y: number;
  radius: number;
  intensity: number;
  flickerSeed: number;
}

/** Every discovered fixture lights the same radius; the engine projection carries no per-fixture
 * radius, so this is the renderer's fixed presentation reach for a lamp/torch. */
const FIXTURE_LIGHT_RADIUS = 4.5;
/** A fixture's base brightness before per-frame flicker is applied by the renderer. */
const FIXTURE_LIGHT_INTENSITY = 1;

/**
 * The multiply-layer alpha (0 = no darkening, keep the scene's own color; 1 = fully dark) for a
 * visible cell of the given engine `intensity` (0-255). Linear and monotonically decreasing:
 * `cellDarkness(255) === 0` (a fully lit cell renders verbatim) and `cellDarkness(0) === 1` (an
 * unlit-but-visible cell renders black). Clamps out-of-range input to the byte range first.
 */
export function cellDarkness(intensity: number): number {
  const clamped = Math.max(0, Math.min(255, intensity));
  return 1 - clamped / 255;
}

/**
 * The brightness floor a VISIBLE cell never drops below in the multiply light-map, mirroring the
 * old DOM renderer's proven `0.6..1.0` opacity band (its `--remembered` gray sat near 0.29, so a
 * visible cell is always clearly brighter than any remembered one). Without this floor a visible
 * cell at a torch's rim -- where the engine's `intensity` bottoms out to single digits -- multiplied
 * to near-black and read DARKER than remembered terrain further out.
 */
export const VISIBLE_FLOOR_BRIGHTNESS = 0.6;

/**
 * The multiply-layer BRIGHTNESS (not darkness) for a visible cell of the given engine `intensity`
 * (0-255): floored at {@link VISIBLE_FLOOR_BRIGHTNESS} and ramping to `1` (scene rendered verbatim)
 * as intensity climbs. Expressed through {@link cellDarkness} so the two stay a single source of
 * truth: `brightness = 1 - (1 - floor) * darkness`. The renderer paints this as a white fill whose
 * alpha is the returned value, so a fully lit cell (`intensity 255`) paints alpha `1` and an
 * unlit-but-visible cell paints alpha `VISIBLE_FLOOR_BRIGHTNESS`.
 */
export function visibleBrightness(intensity: number): number {
  return 1 - (1 - VISIBLE_FLOOR_BRIGHTNESS) * cellDarkness(intensity);
}

/** The cool, dim gray a `remembered` cell (and any feature standing on one) multiplies down to --
 * the old renderer's `--remembered` gray (`#4b526b`, luminance ~0.29). This is the single source of
 * truth shared by the light-map's fov overpaint (which paints remembered floor) and the per-sprite
 * tint of a feature that sits on a remembered cell, so the two never drift apart. */
export const REMEMBERED_TINT = 0x4b526b;

/**
 * The uniform gray-scale tint (`0xRRGGBB`, all three channels equal) for a sprite standing on a
 * VISIBLE cell of the given engine `intensity` (0-255). Sprites render ABOVE the multiply light-map,
 * so they carry their own cell's light as a flat tint instead of being sliced by the per-cell fov
 * geometry. Expressed through {@link visibleBrightness} so the floor and the sprites share one light
 * curve: `intensity 255` yields `0xffffff` (rendered verbatim) and `intensity 0` yields the floored
 * gray `0x999999` -- never black, because an actor on a visible cell is never fully dark. Monotonic
 * in intensity.
 */
export function spriteLightTint(intensity: number): number {
  const channel = Math.round(visibleBrightness(intensity) * 255);
  return (channel << 16) | (channel << 8) | channel;
}

/**
 * The tint a FEATURE sprite (gate/door) carries for its cell. Actors and ground items are FOV-gated
 * to visible cells, but a feature can sit on a `remembered` cell, so it tints to {@link
 * REMEMBERED_TINT} (the same dim gray the fov overpaint paints remembered floor with); a visible
 * feature tints by its cell light via {@link spriteLightTint}.
 */
export function featureLightTint(
  knowledge: ObservableCell['knowledge'],
  intensity: number,
): number {
  return knowledge === 'remembered' ? REMEMBERED_TINT : spriteLightTint(intensity);
}

/**
 * Channel-wise multiply of two `0xRRGGBB` tints, normalized so `compose(c, 0xffffff) === c`. Used to
 * fold a sprite's own tint (a generic item-category color) together with its cell's light tint into
 * one `sprite.tint` value, since Pixi applies a single tint per node.
 */
export function composeTints(base: number, light: number): number {
  const channel = (shift: number): number => {
    const b = (base >> shift) & 0xff;
    const l = (light >> shift) & 0xff;
    return Math.round((b * l) / 255);
  };
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

/**
 * A light pool's on-screen diameter in iso-local pixels for a reach of `radiusTiles` grid cells:
 * `radiusTiles` tiles across at `TILE_HALF_W * 2` px per tile. Camera zoom is applied by the light
 * container's own `scale`, so this is zoom-agnostic. The pool is a `radiusTiles`-across circle, so a
 * radius-5 torch spans `5 * 64 = 320` px, not 5 px -- the unit conversion the renderer must not skip.
 */
export function lightPoolDiameterPx(radiusTiles: number): number {
  return radiusTiles * TILE_HALF_W * 2;
}

/**
 * Whether a cell must be re-stamped OPAQUE in the light map as the final pass, AFTER the additive
 * light pools composite -- true for every non-visible tier (`unknown`, `remembered`). The fog-of-war
 * invariant this enforces: additive light sprites are plain Euclidean radial pools with no
 * line-of-sight shape, so a pool can spill onto an unseen cell around a corner. Overpainting every
 * non-visible cell opaque last guarantees `unknown` renders pure black and `remembered` renders its
 * fixed dim level regardless of light geometry, so a light never hints at hidden terrain. A
 * `visible` cell is never overpainted, so it keeps its floored brightness plus the additive pools.
 */
export function isFogMaskedTier(knowledge: ObservableCell['knowledge']): boolean {
  return knowledge !== 'visible';
}

/**
 * A deterministic per-coordinate flicker phase for a fixture. The pure `lightsForFloor` signature
 * carries no `floorId` (unlike `tile-skinning.ts`'s `cellSeed`), so this folds only `(x, y)`: two
 * different floors' fixtures at the same cell would share a flicker phase, which is invisible since
 * only one floor is ever on screen. Same odd-prime xor mix `cellSeed` uses, minus the floor fold.
 */
function flickerPhase(x: number, y: number): number {
  return ((x * 73856093) ^ (y * 19349663)) >>> 0;
}

/**
 * The full set of light pools to paint for a floor: one per discovered fixture cell (in cell
 * order), then the hero's carried light LAST -- the renderer relies on that ordering to tint the
 * final entry with the equipped light's own color and the fixtures with a warm lamp color. The
 * hero light is always emitted with exactly the `lightRadius` handed in (the caller has already
 * folded the light source's fuel fraction into it); the renderer skips drawing it when that radius
 * is not positive.
 */
export function lightsForFloor(
  cells: readonly ObservableCell[],
  hero: { x: number; y: number; lightRadius: number },
): readonly LightSpec[] {
  const lights: LightSpec[] = [];
  for (const cell of cells) {
    if (cell.fixture === undefined) continue;
    lights.push({
      x: cell.x,
      y: cell.y,
      radius: FIXTURE_LIGHT_RADIUS,
      intensity: FIXTURE_LIGHT_INTENSITY,
      flickerSeed: flickerPhase(cell.x, cell.y),
    });
  }
  lights.push({ x: hero.x, y: hero.y, radius: hero.lightRadius, intensity: 1, flickerSeed: 0 });
  return lights;
}
