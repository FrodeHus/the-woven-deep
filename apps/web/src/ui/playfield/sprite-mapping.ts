import type { ItemCategory } from '@woven-deep/content';
import type { AtlasRect, SpriteAtlas } from './atlas.js';
import { cellSeed } from './tile-skinning.js';

/** Which way an actor sprite faces on screen. The art is drawn facing lower-left, so `'left'` is the
 * un-flipped orientation and `'right'` is the horizontally-mirrored one. */
export type Facing = 'left' | 'right';

/** The hero's fixed atlas key: `HeroView` carries no contentId, and the hero always renders as the
 * one adventurer sprite (mirrors `scene-state`'s `HERO_GLYPH` convention). */
export const HERO_SPRITE_ID = 'hero.adventurer';

/** Generic fallback slots the item atlas ships for categories whose specific ids have no dedicated
 * art: an unidentified/undrawn scroll, tome, or potion reuses these, tinted by the item's color. */
const GENERIC_SCROLL = 'GENERIC-SCROLL';
const GENERIC_TOME = 'GENERIC-TOME';
const GENERIC_POTION = 'GENERIC-POTION';

/** The minimal motion shape the facing rule reads -- decoupled from `scene-state`'s `SpriteMotion`
 * so the two modules do not import each other. */
export interface FacingMotion {
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
}

/**
 * The next facing for an actor given its previous facing and its current motion (or `null` when
 * idle). Screen-x in this iso projection is `(worldX - worldY)`, so a step's eastward (screen-right)
 * component is `(toX - fromX) - (toY - fromY)`: strictly positive means the actor moved right and
 * faces `'right'` (the mirrored sprite), strictly negative means it moved left and faces `'left'`
 * (the drawn orientation). A purely vertical-on-screen step or no motion at all preserves the last
 * facing, so an idle actor never snaps back to a default.
 */
export function resolveFacing(previous: Facing, motion: FacingMotion | null): Facing {
  if (motion === null) return previous;
  const screenDx = motion.toX - motion.fromX - (motion.toY - motion.fromY);
  if (screenDx > 0) return 'right';
  if (screenDx < 0) return 'left';
  return previous;
}

/** The actor sprite crop for a contentId, or `null` when the sheet has no art for it (the renderer
 * then falls back to the glyph). A `null` contentId -- an unperceived/anonymized actor -- also has no
 * sprite. */
export function resolveActorRect(contentId: string | null, atlas: SpriteAtlas): AtlasRect | null {
  if (contentId === null) return null;
  return atlas.sprites[contentId] ?? null;
}

/** A resolved item sprite: the atlas crop plus an optional tint. A tint is applied only to a generic
 * fallback sheet (so a scroll/tome/potion without dedicated art reads in the item's color); dedicated
 * per-item art carries its own palette and is never tinted. */
export interface ItemSpriteResolution {
  readonly rect: AtlasRect;
  readonly tint?: number;
}

/** The item the sprite resolver reads: its identified content id (absent when unidentified), its
 * category, and the projection color that tints a generic fallback. */
export interface ItemSpriteInput {
  readonly contentId?: string | undefined;
  readonly category: ItemCategory;
  readonly color?: string | undefined;
}

/**
 * The floor sprite for a ground item, or `null` to fall back to the glyph. Resolution tiers:
 *
 * 1. Dedicated art -- an identified item whose contentId is a key in the sheet -- drawn untinted.
 * 2. Category generics for anything without dedicated art: a `scroll` reuses `GENERIC-SCROLL`, a
 *    tome (a `misc` item whose id ends `-tome`) reuses `GENERIC-TOME`, and a `potion` reuses
 *    `GENERIC-POTION` -- each tinted by the item's color so it still reads as itself.
 * 3. Everything else returns `null` (glyph fallback).
 */
export function resolveItemSprite(
  item: ItemSpriteInput,
  atlas: SpriteAtlas,
): ItemSpriteResolution | null {
  if (item.contentId !== undefined) {
    const dedicated = atlas.sprites[item.contentId];
    if (dedicated !== undefined) return { rect: dedicated };
  }

  const tint = parseColor(item.color);
  const generic = genericSlotFor(item);
  if (generic === null) return null;
  const rect = atlas.sprites[generic];
  if (rect === undefined) return null;
  return tint === undefined ? { rect } : { rect, tint };
}

function genericSlotFor(item: ItemSpriteInput): string | null {
  if (item.category === 'scroll') return GENERIC_SCROLL;
  if (item.category === 'potion') return GENERIC_POTION;
  if (
    item.category === 'misc' &&
    item.contentId !== undefined &&
    item.contentId.endsWith('-tome')
  ) {
    return GENERIC_TOME;
  }
  return null;
}

/** Parse a `#rrggbb` (or `#rgb`) projection color into a Pixi tint number, or `undefined` when the
 * string is absent or not a hex color the renderer can use (it then leaves the sprite untinted). */
export function parseColor(hex: string | undefined): number | undefined {
  if (hex === undefined) return undefined;
  const match = /^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.exec(hex);
  if (match === null) return undefined;
  const body = match[1] ?? '';
  const full = body.length === 3 ? body.replace(/./g, (channel) => channel + channel) : body;
  return Number.parseInt(full, 16);
}

/** Peak vertical travel (dest px) of the ground-item hover bob, measured from rest. */
export const HOVER_AMPLITUDE_PX = 2.5;
const HOVER_ANGULAR_SPEED = 2.4;

/**
 * The upward hover offset (in destination px) for a ground item at `(x, y)` on `floorId` at time
 * `nowMs`. A slow sine bob draws the eye without reading as a bounce; the phase is derived from the
 * cell's `cellSeed` so neighboring items never bob in lockstep and every item's phase is stable
 * across re-renders and reloads (never `Math.random`). The result is bounded by `HOVER_AMPLITUDE_PX`.
 */
export function groundItemHoverOffset(
  floorId: string,
  x: number,
  y: number,
  nowMs: number,
): number {
  const phase = (cellSeed(floorId, x, y) % 628) / 100;
  return Math.sin((nowMs / 1000) * HOVER_ANGULAR_SPEED + phase) * HOVER_AMPLITUDE_PX;
}
