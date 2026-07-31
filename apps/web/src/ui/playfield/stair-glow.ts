import type { ObservableCell } from '@woven-deep/engine';
import { cellSeed } from './tile-skinning.js';

/** Which way a stair leads. Both stair tiles share the `terrain.stair` token, so the projected
 * `glyph` (`>` down, `<` up) is the only field that separates them client-side. */
export type StairDirection = 'down' | 'up';

/**
 * One breathing ambient glow the renderer paints over a discovered stair cell: its grid position,
 * which way the stair leads (the tint), and a stable phase offset so two stairs on one floor never
 * pulse in lockstep.
 */
export interface StairGlowSpec {
  readonly x: number;
  readonly y: number;
  readonly direction: StairDirection;
  readonly phase: number;
}

/** Warm ember for a way down -- the descent reads as heat from below. */
export const STAIR_DOWN_GLOW_COLOR = 0xffb265;
/** Cool daylight for a way back up. */
export const STAIR_UP_GLOW_COLOR = 0x7fb6ff;

/** The floor of the breathing band. Deliberately non-zero: the glow never blinks fully out, it
 * just recedes. */
export const STAIR_GLOW_MIN_ALPHA = 0.08;
/** The ceiling of the breathing band. Ambiance, not UI -- a stair must never look like a marker
 * pinned on the world, so this stays far below the light pools it shares the scene with. */
export const STAIR_GLOW_MAX_ALPHA = 0.2;

/** How far a stair glow reaches, in grid cells. Roughly one and a half tiles across: enough to
 * bloom past the tile's own edges, not enough to light a neighbour. */
export const STAIR_GLOW_RADIUS_TILES = 1.6;

/** Radians per second of the breathing cycle -- ~7s per full breath, slow enough to read as
 * ambient rather than as a blink. */
const BREATH_ANGULAR_SPEED = 0.9;

/** A fixed key folded into {@link cellSeed} so a glow's phase never collides with the floor's real
 * per-cell skin seeds; the pure signature here carries no `floorId` (only one floor is ever on
 * screen, so two floors sharing a phase at the same cell is invisible). */
const STAIR_GLOW_SEED_KEY = 'stair-glow';

/**
 * The breathing alpha for a stair glow at `phase` and time `nowMs`, always inside
 * `[STAIR_GLOW_MIN_ALPHA, STAIR_GLOW_MAX_ALPHA]`. Pure and ticker-driven: nothing here reads or
 * affects game state, so it is safe to animate every frame.
 */
export function stairGlowAlpha(phase: number, nowMs: number): number {
  const wave = 0.5 + 0.5 * Math.sin((nowMs / 1000) * BREATH_ANGULAR_SPEED + phase);
  return STAIR_GLOW_MIN_ALPHA + (STAIR_GLOW_MAX_ALPHA - STAIR_GLOW_MIN_ALPHA) * wave;
}

/**
 * Every stair glow to paint for a floor, in cell order: one per DISCOVERED (`remembered` or
 * `visible`) `terrain.stair` cell. An `unknown` cell is skipped, so the glow can never hint at a
 * stair the hero has not found -- the same fog invariant the light layer's `isFogMaskedTier`
 * enforces for light pools.
 */
export function stairGlowsForFloor(cells: readonly ObservableCell[]): readonly StairGlowSpec[] {
  const glows: StairGlowSpec[] = [];
  for (const cell of cells) {
    if (cell.knowledge === 'unknown' || cell.token !== 'terrain.stair') continue;
    if (cell.glyph !== '>' && cell.glyph !== '<') continue;
    glows.push({
      x: cell.x,
      y: cell.y,
      direction: cell.glyph === '>' ? 'down' : 'up',
      phase: (cellSeed(STAIR_GLOW_SEED_KEY, cell.x, cell.y) % 628) / 100,
    });
  }
  return glows;
}
