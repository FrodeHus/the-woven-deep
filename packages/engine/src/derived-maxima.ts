import type { CompiledContentPack } from '@woven-deep/content';
import { withActor } from './actor-model.js';
import type { ActiveRun } from './model.js';
import { deriveRunActorStats } from './stats.js';

const MINIMUM_LIVING_HEALTH = 1;

/**
 * Refreshes the HERO actor's stored `maxHealth`/`maxWeave` from `deriveRunActorStats`, clamping
 * current health and weave into the new bounds. Pure, idempotent, and randomness-free.
 *
 * The stored fields are a CACHE of the derived outputs, not an independent snapshot: `health <=
 * maxHealth` is a content-free save invariant (`save-schema/run-record.ts`), so a derived value
 * that readers honored while the stored field stayed stale would make a +maxHealth item produce an
 * unsavable run. Refreshing the cache instead makes every existing reader (HUD, heal caps, rest,
 * the below-half curse crossing) authoritative without touching one of them.
 *
 * Hero only: a champion/echo actor's `maxHealth` is pinned to its normalized template health by
 * `content-bound-validation.ts`, and monsters carry neither equipment nor hero modifiers.
 */
export function synchronizeDerivedMaxima(
  state: ActiveRun,
  content: CompiledContentPack,
): ActiveRun {
  const hero = state.actors.find((actor) => actor.actorId === state.hero.actorId);
  if (!hero) throw new Error('internal invariant: hero actor does not exist');
  const derived = deriveRunActorStats({ state, content, actor: hero });
  const maxHealth = Math.max(MINIMUM_LIVING_HEALTH, derived.maxHealth);
  const maxWeave = Math.max(0, derived.maxWeave);
  if (!Number.isSafeInteger(maxHealth) || !Number.isSafeInteger(maxWeave)) {
    throw new RangeError('derived maxima must be safe integers');
  }
  // A dead hero stays dead: the conclusion boundary owns health 0, and floor-1 clamping here
  // would resurrect a corpse between the killing blow and `concludeRunOnHeroDeath`.
  const health =
    hero.health === 0 ? 0 : Math.min(Math.max(MINIMUM_LIVING_HEALTH, hero.health), maxHealth);
  const weave = Math.min(hero.weave, maxWeave);
  if (
    hero.maxHealth === maxHealth &&
    hero.maxWeave === maxWeave &&
    hero.health === health &&
    hero.weave === weave
  ) {
    return state;
  }
  return withActor(state, { ...hero, maxHealth, maxWeave, health, weave });
}
