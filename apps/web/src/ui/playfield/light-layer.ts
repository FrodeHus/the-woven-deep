import type { ObservableCell } from '@woven-deep/engine';
import { TILE_HALF_W } from './iso-math.js';
import { cellSeed } from './tile-skinning.js';

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
 * The relative luminance (0..1) of a `0xRRGGBB` tint, on the same scale the multiply light-map's
 * brightness values use. Rec. 601 weights, so a comparison between a colored tint and a plain
 * brightness factor reflects what the eye actually reads as "darker".
 */
export function tintLuminance(tint: number): number {
  const r = (tint >> 16) & 0xff;
  const g = (tint >> 8) & 0xff;
  const b = tint & 0xff;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/**
 * The mean brightness the void-fill noise texture is normalized to at build time. Unexcavated stone
 * must sit at the BOTTOM of the playfield's contrast ladder -- strictly darker than {@link
 * REMEMBERED_TINT} (remembered terrain), which is in turn darker than {@link
 * VISIBLE_FLOOR_BRIGHTNESS} (the floor a visible cell never drops below) -- so the eye reads
 * unexplored space as solid rock rather than as somewhere already walked. The ordering is pinned by
 * test, comparing against {@link tintLuminance}`(REMEMBERED_TINT)` rather than a duplicated literal.
 */
export const VOID_ROCK_BRIGHTNESS = 0.03;

/** Per-pixel brightness spread (standard deviation) the void-fill noise field is normalized to
 * around {@link VOID_ROCK_BRIGHTNESS} -- barely-there variation, never a hard edge. */
export const VOID_ROCK_BRIGHTNESS_VARIATION = 0.01;

/** Edge length (px) of the square void-fill noise field/texture. */
export const VOID_NOISE_SIZE = 256;

/** How many soft blotches are stamped into the noise field. Enough to avoid any single blotch
 * reading as a recognizable shape once normalized into the tight dark band. */
const VOID_NOISE_BLOTCH_COUNT = 90;

/** A fixed key folded into {@link cellSeed} so the void-noise hash never collides with a real
 * floor's per-cell seed space; any floorId that is never a real floor id would do. */
const VOID_NOISE_SEED_KEY = 'void-noise-field';

/** A deterministic pseudo-random unit value (`0..1`) for blotch parameter `slot` of blotch `index`,
 * derived from {@link cellSeed}'s FNV/xor mix -- same inputs always yield the same value, no
 * `Math.random`. */
function voidNoiseUnit(index: number, slot: number): number {
  return cellSeed(VOID_NOISE_SEED_KEY, index, slot) / 0xffffffff;
}

/**
 * Adds one soft (Gaussian) blotch, centered at `(cx, cy)` with the given `radius` and signed
 * `amplitude`, into `field` (a `size`×`size` row-major buffer). Only the pixels within `3 * radius`
 * of the center are touched -- everywhere else the Gaussian falloff is negligible.
 */
function stampBlotch(
  field: Float32Array,
  size: number,
  cx: number,
  cy: number,
  radius: number,
  amplitude: number,
): void {
  const reach = radius * 3;
  const minX = Math.floor(cx - reach);
  const maxX = Math.ceil(cx + reach);
  const minY = Math.floor(cy - reach);
  const maxY = Math.ceil(cy + reach);
  const twoRadiusSq = 2 * radius * radius;
  for (let y = Math.max(0, minY); y <= Math.min(size - 1, maxY); y += 1) {
    for (let x = Math.max(0, minX); x <= Math.min(size - 1, maxX); x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const falloff = Math.exp(-(dx * dx + dy * dy) / twoRadiusSq);
      const at = y * size + x;
      field[at] = (field[at] as number) + amplitude * falloff;
    }
  }
}

/**
 * Builds a deterministic, seamlessly-tileable amorphous noise field for the void-fill rock texture:
 * `size`×`size` values (row-major, `field[y * size + x]`), each an RGB-equal luminance normalized
 * into a tight dark band around {@link VOID_ROCK_BRIGHTNESS} (spread {@link
 * VOID_ROCK_BRIGHTNESS_VARIATION}) and clamped to `[0, 1]`.
 *
 * Every blotch is soft (Gaussian falloff, no hard edges) and stamped at its own position PLUS its
 * eight `±size` wrapped copies, so a blotch near one edge also contributes near the opposite edge --
 * the field tiles with no visible seam without needing toroidal distance math. Blotch center,
 * radius, sign, and strength are all drawn from {@link cellSeed} (via {@link voidNoiseUnit}), so the
 * same `size` always produces byte-identical output -- no `Math.random`, stable across reloads.
 */
export function buildVoidNoiseField(size: number = VOID_NOISE_SIZE): Float32Array {
  const field = new Float32Array(size * size);
  for (let index = 0; index < VOID_NOISE_BLOTCH_COUNT; index += 1) {
    const cx = voidNoiseUnit(index, 1) * size;
    const cy = voidNoiseUnit(index, 2) * size;
    const radius = size * (0.05 + voidNoiseUnit(index, 3) * 0.09);
    const sign = voidNoiseUnit(index, 4) < 0.5 ? -1 : 1;
    const amplitude = sign * (0.4 + voidNoiseUnit(index, 5) * 0.6);
    for (let wrapX = -1; wrapX <= 1; wrapX += 1) {
      for (let wrapY = -1; wrapY <= 1; wrapY += 1) {
        stampBlotch(field, size, cx + wrapX * size, cy + wrapY * size, radius, amplitude);
      }
    }
  }

  let mean = 0;
  for (let index = 0; index < field.length; index += 1) mean += field[index] as number;
  mean /= field.length;
  let variance = 0;
  for (let index = 0; index < field.length; index += 1) {
    const delta = (field[index] as number) - mean;
    variance += delta * delta;
  }
  const stdDev = Math.sqrt(variance / field.length) || 1;

  for (let index = 0; index < field.length; index += 1) {
    const z = ((field[index] as number) - mean) / stdDev;
    const value = VOID_ROCK_BRIGHTNESS + VOID_ROCK_BRIGHTNESS_VARIATION * z;
    field[index] = Math.max(0, Math.min(1, value));
  }
  return field;
}

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
