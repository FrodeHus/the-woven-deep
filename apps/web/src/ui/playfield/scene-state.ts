import type { ItemCategory } from '@woven-deep/content';
import type { SessionSnapshot } from '../../session/guest-session.js';
import { actorsOf, groundItemsOf, heroOf } from '../../session/projection-view.js';
import { effectsForEvents, type ActorPositions, type TransientEffect } from '../effects-map.js';
import { HERO_SPRITE_ID, resolveFacing, type Facing } from './sprite-mapping.js';

/** Ticks a single actor/hero sprite from `fromX/fromY` to `toX/toY`, started at `startedAt`. */
export interface SpriteMotion {
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
  readonly startedAt: number;
  readonly durationMs: number;
}

export interface ActorSprite {
  readonly id: string;
  /** The content id used to look up the actor's atlas sprite. `HERO_SPRITE_ID` for the hero; the
   * `ActorView` contentId (or `null` for an anonymized/unperceived actor) otherwise. A `null`/unmapped
   * id renders the glyph fallback. */
  readonly contentId: string | null;
  readonly glyph: string;
  readonly color: string | undefined;
  readonly isHero: boolean;
  readonly motion: SpriteMotion | null;
  /** Persisted screen facing: updated by each eastward/westward step, preserved while idle so a
   * resting actor never snaps back to the drawn orientation. */
  readonly facing: Facing;
  readonly x: number;
  readonly y: number;
  readonly health: number;
  readonly maxHealth: number;
}

/** A perceived ground item, carrying the fields the renderer needs to pick a sprite (or fall back to
 * the glyph) and to hover-bob it in place. */
export interface GroundItemSprite {
  readonly id: string;
  readonly contentId: string | undefined;
  readonly category: ItemCategory;
  readonly glyph: string;
  readonly color: string | undefined;
  readonly x: number;
  readonly y: number;
}

export interface SceneState {
  readonly floorId: string;
  readonly actors: readonly ActorSprite[];
  readonly groundItems: readonly GroundItemSprite[];
  readonly effects: readonly TransientEffect[];
  /** Timestamp of the last hero-damage event, drives vignette/shake. `null` when this snapshot's
   * `lastEvents` carried no `hero.damaged` event. */
  readonly hurtAt: number | null;
  readonly concludedByDeath: boolean;
}

/** Every command's world-position tween runs for the same fixed duration. */
export const STEP_MS = 180;

const DEFAULT_GLYPH = '?';
/** `IsoRenderer`'s hero glyph convention: the hero always renders as '@', regardless of any
 * content-driven glyph -- `HeroView` carries no glyph field at all, so this is not a fallback,
 * it is the hero's one and only glyph. */
const HERO_GLYPH = '@';

/**
 * `CompletionType` (`packages/content/src/model/common.ts`) is `'died' | 'became-heart' |
 * 'refused' | 'broke-cycle'` -- there is no literal named `'death'`; `'died'` is the one variant
 * that means the hero's run ended by dying, so that is the exact literal this predicate checks.
 * Exported (not just inlined into `nextSceneState`) because a later task's death overlay imports
 * this exact predicate by name.
 */
export function concludedByDeath(snapshot: SessionSnapshot): boolean {
  const conclusion = snapshot.projection.conclusion;
  return conclusion !== null && conclusion.completionType === 'died';
}

/** Smoothstep-eased interpolation, clamped to `[0, 1]` at the edges. */
function smoothstep(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped * clamped * (3 - 2 * clamped);
}

/** The sprite's current rendered world position: interpolated along its `motion` tween at `now`,
 * or its resting `(x, y)` when it has no motion in flight. */
export function motionPosition(sprite: ActorSprite, now: number): readonly [number, number] {
  const { motion } = sprite;
  if (motion === null) return [sprite.x, sprite.y];
  const elapsed = now - motion.startedAt;
  const t = motion.durationMs <= 0 ? 1 : elapsed / motion.durationMs;
  const eased = smoothstep(t);
  const x = motion.fromX + (motion.toX - motion.fromX) * eased;
  const y = motion.fromY + (motion.toY - motion.fromY) * eased;
  return [x, y];
}

function findPrevSprite(prev: SceneState | null, id: string): ActorSprite | undefined {
  return prev?.actors.find((sprite) => sprite.id === id);
}

function buildSprite(
  input: Readonly<{
    id: string;
    contentId: string | null;
    glyph: string | undefined;
    color: string | undefined;
    isHero: boolean;
    x: number;
    y: number;
    health: number;
    maxHealth: number;
  }>,
  prev: SceneState | null,
  floorChanged: boolean,
  now: number,
): ActorSprite {
  const prevSprite = floorChanged ? undefined : findPrevSprite(prev, input.id);
  const glyph = input.glyph ?? prevSprite?.glyph ?? DEFAULT_GLYPH;
  const previousFacing: Facing = prevSprite?.facing ?? 'left';

  if (prevSprite === undefined || (prevSprite.x === input.x && prevSprite.y === input.y)) {
    return {
      id: input.id,
      contentId: input.contentId,
      glyph,
      color: input.color,
      isHero: input.isHero,
      motion: null,
      facing: previousFacing,
      x: input.x,
      y: input.y,
      health: input.health,
      maxHealth: input.maxHealth,
    };
  }

  const [fromX, fromY] = motionPosition(prevSprite, now);
  const motion = { fromX, fromY, toX: input.x, toY: input.y, startedAt: now, durationMs: STEP_MS };
  return {
    id: input.id,
    contentId: input.contentId,
    glyph,
    color: input.color,
    isHero: input.isHero,
    motion,
    facing: resolveFacing(previousFacing, motion),
    x: input.x,
    y: input.y,
    health: input.health,
    maxHealth: input.maxHealth,
  };
}

/**
 * Diffs `snapshot` against the previously rendered `prev` scene state and schedules any
 * position tweens: an actor id present in both scenes at a new cell gets a `motion` running from
 * its currently-interpolated rendered position (so a command mid-tween snaps forward smoothly,
 * never restarting from its old resting cell) to the new cell, over `STEP_MS`. A brand-new actor
 * id, `prev === null`, or a floor change all appear in place with no motion.
 */
export function nextSceneState(
  prev: SceneState | null,
  snapshot: SessionSnapshot,
  now: number,
): SceneState {
  const { projection } = snapshot;
  const floorId = projection.floor.floorId;
  const floorChanged = prev !== null && prev.floorId !== floorId;

  const hero = heroOf(projection);
  const heroSprite = buildSprite(
    {
      id: hero.actorId,
      contentId: HERO_SPRITE_ID,
      glyph: HERO_GLYPH,
      color: undefined,
      isHero: true,
      x: hero.x,
      y: hero.y,
      health: hero.health,
      maxHealth: hero.maxHealth,
    },
    prev,
    floorChanged,
    now,
  );

  const actorSprites = actorsOf(projection).map((actor) =>
    buildSprite(
      {
        id: actor.actorId,
        contentId: actor.contentId,
        glyph: actor.glyph,
        color: actor.color,
        isHero: false,
        x: actor.x,
        y: actor.y,
        health: actor.health,
        maxHealth: actor.maxHealth,
      },
      prev,
      floorChanged,
      now,
    ),
  );

  const groundItems: readonly GroundItemSprite[] = groundItemsOf(projection).map((item) => ({
    id: item.itemId,
    contentId: item.contentId,
    category: item.category,
    glyph: item.glyph ?? DEFAULT_GLYPH,
    color: item.color,
    x: item.x,
    y: item.y,
  }));

  const positions: ActorPositions = new Map([
    [hero.actorId, { x: hero.x, y: hero.y }],
    ...actorsOf(projection).map((actor) => [actor.actorId, { x: actor.x, y: actor.y }] as const),
  ]);
  const eventEffects = effectsForEvents(snapshot.lastEvents, hero.actorId, positions);

  // The hero's own `actor.died` is deliberately never projected (the conclusion overlay owns that
  // moment), so the hero's death burst is keyed off the conclusion transition instead: it fires on
  // the one snapshot where the death conclusion first appears, never off `actor.died`.
  const heroDied = concludedByDeath(snapshot);
  const burstsNow = heroDied && prev?.concludedByDeath !== true;
  const effects: readonly TransientEffect[] = burstsNow
    ? [
        ...eventEffects,
        { key: `death-burst.${hero.actorId}`, kind: 'death-burst', x: hero.x, y: hero.y },
      ]
    : eventEffects;

  const hurt = snapshot.lastEvents.some((event) => event.type === 'hero.damaged');

  return {
    floorId,
    actors: [heroSprite, ...actorSprites],
    groundItems,
    effects,
    hurtAt: hurt ? now : null,
    concludedByDeath: heroDied,
  };
}
