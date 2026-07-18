export type RgbTuple = readonly [number, number, number];

/**
 * `.cell-remembered`'s static color in `styles.css`, reproduced as a plain constant so this module
 * -- and its tests -- can reason about the remembered floor without parsing the stylesheet. Do not
 * let the two drift: if `.cell-remembered`'s color literal ever changes, update this too.
 */
const REMEMBERED_RGB: RgbTuple = [0x4b, 0x52, 0x6b];

/**
 * The floor a visible cell's color blends up from at zero intensity. Chosen so its relative
 * luminance clears `REMEMBERED_RGB`'s by a healthy margin (roughly 1.9x) -- this is the color-
 * channel half of the "dark ring" bug fix: 5C already floored `.cell-visible`'s OPACITY above the
 * remembered floor (`styles.css`'s `calc(0.62 + 0.38 * var(--light))`), but left the COLOR
 * (`--fg`, the engine's per-cell `tint`) free to go near-black at the light-radius rim, where
 * `intensity` bottoms out to single digits. A wall right inside a torch's radius could render
 * darker (near-black glyph on a near-black-tinted ground) than the remembered gray one cell
 * further out. Flooring the color the same way the opacity is floored closes that gap.
 */
const FLOOR_RGB: RgbTuple = [100, 106, 130];

function srgbToLinear(channel: number): number {
  const c = Math.max(0, Math.min(255, channel)) / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Inverse of {@link srgbToLinear}: a linear-light channel (0..1) back to an sRGB byte (0..255). */
function linearToSrgb(linear: number): number {
  const c = Math.max(0, Math.min(1, linear));
  const srgb = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(srgb * 255);
}

/** WCAG relative luminance of an sRGB triple, 0 (black) to 1 (white). */
export function relativeLuminance([r, g, b]: RgbTuple): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/**
 * WCAG 2.x contrast ratio between two sRGB colors, from 1 (identical) to 21 (black on white).
 * Order of the two arguments doesn't matter -- the formula always divides the lighter relative
 * luminance by the darker. Shared by `styles-contract.test.ts`'s AA assertions (computed from the
 * REAL parsed `:root`/`.theme-high-contrast` values, never a copied number) and available for any
 * future caller that needs the same ratio.
 */
export function contrastRatio(a: RgbTuple, b: RgbTuple): number {
  const lumA = relativeLuminance(a);
  const lumB = relativeLuminance(b);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * `relativeLuminance(FLOOR_RGB)` -- the luminance a visible cell's color must never drop below,
 * for ANY tint. `FLOOR_RGB` itself sits exactly at this floor (it's what a cell renders at
 * `intensity` 0), so re-deriving the constant from it keeps the two from drifting apart.
 */
const FLOOR_LUMINANCE = relativeLuminance(FLOOR_RGB);

/**
 * `liftToFloor` targets a hair above `FLOOR_LUMINANCE`, not the exact value: its output goes
 * through one more round-to-nearest-byte step (`linearToSrgb`) after the target is hit, and that
 * last rounding can shave a channel down by up to half a byte, which is enough to pull the
 * resulting luminance back under the floor by a hair. Overshooting the target by this margin
 * before rounding keeps the post-rounding result at or above the true floor.
 */
const ROUNDING_SAFETY_MARGIN = 0.002;

/**
 * Lifts `rgb` so its relative luminance is at least `FLOOR_LUMINANCE`, preserving hue as closely
 * as possible. A plain linear blend toward `FLOOR_RGB` (the previous implementation) only holds
 * the floor for tints whose own luminance already exceeds it -- a cool/blue-dominant tint (e.g. a
 * pure-blue light) blends from the floor color's warm-ish gray *down* toward blue as `intensity`
 * rises, since blue contributes only 7.22% to relative luminance, so the output can end up
 * darker than the floor (and, at the extreme, darker than the remembered gray) the moment such a
 * tint is authored. This makes the floor hold unconditionally in two steps:
 *
 * 1. Convert to linear light and scale ALL channels by the same factor so the resulting luminance
 *    (a linear combination of linear channels) hits the floor exactly. This is a pure brightness
 *    scale -- hue and saturation ratios are preserved -- but a channel can clip at 1.0 before the
 *    target luminance is reached (e.g. pure blue: even fully-saturated blue at max intensity linear
 *    only contributes 0.0722, short of a ~0.146 floor).
 * 2. If clipping left the scaled color still under the floor, mix the remainder toward white in
 *    linear space (mixing toward `FLOOR_RGB` would work equally well since it's already at the
 *    floor, but white keeps the direction hue-neutral rather than pulling toward the floor's own
 *    cool-leaning gray). This is the only path that runs for saturated primaries; warm content
 *    tints never reach it because scaling alone clears the floor for them.
 */
function liftToFloor(rgb: RgbTuple): RgbTuple {
  const linear = rgb.map(srgbToLinear) as [number, number, number];
  const luminance = (l: readonly [number, number, number]) => 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
  const currentLuminance = luminance(linear);
  if (currentLuminance >= FLOOR_LUMINANCE) return rgb.map(Math.round) as unknown as RgbTuple;

  const target = FLOOR_LUMINANCE + ROUNDING_SAFETY_MARGIN;
  const scaled: [number, number, number] =
    currentLuminance > 0
      ? (linear.map((c) => Math.min(1, (c * target) / currentLuminance)) as [number, number, number])
      : [0, 0, 0];
  const scaledLuminance = luminance(scaled);
  if (scaledLuminance >= target) {
    return scaled.map(linearToSrgb) as unknown as RgbTuple;
  }

  // Clipping capped the scale before the floor was reached (e.g. a saturated blue) -- make up the
  // remainder by mixing toward white (luminance 1) in linear space.
  const headroom = 1 - scaledLuminance;
  const mix = headroom > 0 ? (target - scaledLuminance) / headroom : 1;
  const lifted = scaled.map((c) => c + mix * (1 - c)) as [number, number, number];
  return lifted.map(linearToSrgb) as unknown as RgbTuple;
}

/**
 * A visible cell's rendered foreground color (the `--fg` custom property `GridRenderer` and
 * `MapJournalOverlay` set on `.cell-visible`/`.map-cell-visible`). Blends `base` (defaulting to
 * `FLOOR_RGB`, the generic pre-material floor) toward the engine's own `tint` as `intensity` climbs
 * from 0 to 255 (clamped), then, since that blend alone only holds the luminance floor for tints
 * already at or above it (see {@link liftToFloor}), lifts the result back up to `FLOOR_LUMINANCE`
 * whenever the blend dipped under it. At `intensity` 255 a tint whose own luminance already clears
 * the floor renders verbatim (identity -- a gold torch rim still reads gold); a tint that doesn't
 * (e.g. a hypothetical pure-blue light) gets lifted even at full intensity, so a visible cell can
 * never render darker-than-remembered before `knowledge` flips it to the (also-floored) remembered
 * rendering one cell further out, for any hue -- and, since the floor lift is unconditional on
 * `base`, this holds for ANY material base too (see `MATERIAL_BASE_RGB` below and its property
 * tests in `cell-color.test.ts`), not just the generic floor.
 *
 * `base` is `GridRenderer`'s hook for material coloring: passing a cell's material base
 * color (e.g. `MATERIAL_BASE_RGB.wall`) makes a lit wall read mineral blue-grey at low intensity
 * instead of the old one-size-fits-all `FLOOR_RGB` gray, while still guaranteeing the same floor.
 *
 * Pure presentation only: the engine's `tint`/`intensity` fields are read, never written or
 * reinterpreted -- this is strictly how they get painted.
 */
/**
 * The maximum blend fraction toward `tint` for an explicit MATERIAL base -- caps `t` so at least
 * `1 - MATERIAL_MAX_BLEND_T` (15%) of the material's own base color always survives, even at a
 * torch's brightest rim (`intensity` 255). Without this cap, a wall cell right beside a carried
 * torch would render nearly indistinguishable from the warm floor beside it -- at `intensity` 255
 * the blend is (by design) the tint verbatim, so ANY base washes out completely at the light's
 * core, and a wall/door/stair one cell from the hero would sit well into that washout zone. The
 * generic (no-material) floor path is deliberately exempt -- see
 * `isDefaultFloorBase` below -- so the pre-existing identity-at-255 contract for a plain call
 * (`cell-color.test.ts`'s "renders the tint verbatim... so a gold torch rim stays gold") still
 * holds unchanged; only an explicit, distinct material base is capped.
 */
const MATERIAL_MAX_BLEND_T = 0.85;

/** True if `base` is exactly `FLOOR_RGB` (the generic, no-material default) -- the one case
 * `visibleForeground` does NOT apply {@link MATERIAL_MAX_BLEND_T} to, so an un-parameterized call
 * (or an explicit `FLOOR_RGB` base, per the "no-op" contract test) keeps its exact tint-at-255
 * identity. */
function isDefaultFloorBase(base: RgbTuple): boolean {
  return base[0] === FLOOR_RGB[0] && base[1] === FLOOR_RGB[1] && base[2] === FLOOR_RGB[2];
}

export function visibleForeground(tint: RgbTuple, intensity: number, base: RgbTuple = FLOOR_RGB): string {
  const rawT = Math.max(0, Math.min(255, intensity)) / 255;
  const t = isDefaultFloorBase(base) ? rawT : Math.min(rawT, MATERIAL_MAX_BLEND_T);
  const blended = [0, 1, 2].map((index) => base[index]! + t * (tint[index]! - base[index]!)) as unknown as RgbTuple;
  const [r, g, b] = liftToFloor(blended);
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * The five material identities `materialClass` (`GridRenderer.tsx`) can derive from a cell's
 * terrain token: a pillar reuses `wall`'s base (structural mineral stone) and both stair
 * directions reuse `stair`'s, matching `styles.css`'s `--mat-*` custom properties one-to-one --
 * `wall`/`floor`/`door`/`stair`/`void` are the only distinct bases, mirroring the CSS file having
 * only `--mat-wall`/`--mat-floor`/`--mat-door`/`--mat-stair`/`--mat-void` (no separate
 * `--mat-pillar`). Do not let these hex values drift from `styles.css`'s `--mat-*` declarations.
 */
export type MaterialBaseName = 'wall' | 'floor' | 'door' | 'stair' | 'void';

export const MATERIAL_BASE_RGB: Readonly<Record<MaterialBaseName, RgbTuple>> = {
  wall: [0x5b, 0x64, 0x78],
  floor: [0x8a, 0x7f, 0x6e],
  door: [0x8b, 0x5a, 0x3c],
  stair: [0xc9, 0xa2, 0x27],
  void: [0x23, 0x27, 0x33],
};
