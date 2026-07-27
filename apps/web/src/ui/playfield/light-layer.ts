import type { ObservableCell } from '@woven-deep/engine';

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
