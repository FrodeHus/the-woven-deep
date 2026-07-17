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

/** WCAG relative luminance of an sRGB triple, 0 (black) to 1 (white). */
export function relativeLuminance([r, g, b]: RgbTuple): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/**
 * A visible cell's rendered foreground color (the `--fg` custom property `GridRenderer` and
 * `MapJournalOverlay` set on `.cell-visible`/`.map-cell-visible`). Blends `FLOOR_RGB` toward the
 * engine's own `tint` as `intensity` climbs from 0 to 255 (clamped): at `intensity` 255 the output
 * is `tint` verbatim (identity -- a gold torch rim still reads gold), and at low intensity the
 * floor keeps the output's luminance comfortably above the remembered gray's, so a visible cell
 * can never render darker-than-remembered before `knowledge` flips it to the (also-floored)
 * remembered rendering one cell further out.
 *
 * Pure presentation only: the engine's `tint`/`intensity` fields are read, never written or
 * reinterpreted -- this is strictly how they get painted.
 */
export function visibleForeground(tint: RgbTuple, intensity: number): string {
  const t = Math.max(0, Math.min(255, intensity)) / 255;
  const [r, g, b] = [0, 1, 2].map((index) => Math.round(FLOOR_RGB[index]! + t * (tint[index]! - FLOOR_RGB[index]!)));
  return `rgb(${r}, ${g}, ${b})`;
}
