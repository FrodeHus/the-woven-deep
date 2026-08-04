import type { CompiledContentPack, SpellContentEntry } from '@woven-deep/content';
import type { CastAction } from './action-types.js';
import type { ActorState } from './actor-model.js';
import { actorDistance, awareHostileTarget } from './behavior-targeting.js';
import { entryById } from './content-index.js';
import type { ActiveRun, OpaqueId } from './model.js';
import { compareCodeUnits } from './stable-json.js';
import { targetContext } from './target-context.js';
import { validateTarget } from './targeting.js';

/** The targeting kinds a haunt casts. The aimed and area kinds need an aim-point heuristic and
 * friendly-fire rules that this version deliberately does not have (see the design's non-goals),
 * so a recorded ability of any other kind is simply passed over. */
const SUPPORTED_TARGETING = new Set(['target.actor', 'target.self']);

/**
 * Would this self-targeted spell do anything? A haunt has one Weave pool and no way to earn it
 * back, so casting a heal at full health or re-applying a condition it already carries would
 * burn the pool for nothing and read as broken. Heals count as useful below maximum health;
 * a condition applier counts as useful while the caster lacks that condition. Anything else --
 * a self spell this rule cannot reason about -- is passed over rather than guessed at.
 */
function selfCastIsUseful(actor: ActorState, spell: SpellContentEntry): boolean {
  return spell.effects.some((effect) => {
    if (effect.effectId === 'effect.heal') return actor.health < actor.maxHealth;
    if (effect.effectId === 'effect.condition.apply') {
      const conditionId = effect.parameters.conditionId;
      return (
        typeof conditionId === 'string' &&
        !actor.conditions.some((condition) => condition.conditionId === conditionId)
      );
    }
    return false;
  });
}

/**
 * The spell a placed haunt casts this turn, or `null` to fall through to its ordinary behavior.
 *
 * Champions and Echoes are the only populations carrying `abilityIds` (the signature spells their
 * standing recorded), and this is the consumer that data was waiting for. The rules:
 *
 * - Never adjacent. Melee range belongs to the bump-attack branch, which keeps "close the
 *   distance" a real counter-play against a caster haunt.
 * - Legality comes from `validateTarget`, the hero's own targeting call, so range, line of sight,
 *   and illumination bind a haunt exactly as they bind the player.
 * - Attack spells outrank self spells; within each group the costliest goes first, ranked by the
 *   same comparator `run-finalize.ts` used to choose these spells in the first place, so "the
 *   champion's signature spells" means one thing everywhere.
 * - Affordability is the only pacing: Weave regen is hero-only, so a haunt's pool is a one-way
 *   per-encounter budget.
 *
 * Consumes no randomness: every input is state or content, and the spell's own effects do all the
 * drawing later, from the `effects` stream, through the shared cast resolver.
 */
export function championCastAction(
  input: Readonly<{ state: ActiveRun; actorId: OpaqueId; content: CompiledContentPack }>,
): CastAction | null {
  const actor = input.state.actors.find((candidate) => candidate.actorId === input.actorId);
  if (!actor || actor.health <= 0) return null;
  const population = input.state.populations.find(
    (candidate) => candidate.populationId === actor.populationId,
  );
  if (population?.model !== 'champion' && population?.model !== 'echo') return null;
  if (population.abilityIds.length === 0) return null;

  // The SAME selection the melee and pathing branches use, so a haunt can never cast at one
  // actor while walking toward another.
  const target = awareHostileTarget({ state: input.state, actor });
  if (!target || actorDistance(actor, target) <= 1) return null;

  const spells = population.abilityIds
    .flatMap((spellId) => {
      const entry = entryById(input.content, spellId);
      return entry?.kind === 'spell' && SUPPORTED_TARGETING.has(entry.targetingId) ? [entry] : [];
    })
    .filter((spell) => spell.weaveCost <= actor.weave)
    .sort((left, right) => right.weaveCost - left.weaveCost || compareCodeUnits(left.id, right.id));

  const perception = targetContext(input.state, actor, input.content);
  for (const group of ['target.actor', 'target.self'] as const) {
    for (const spell of spells) {
      if (spell.targetingId !== group) continue;
      if (group === 'target.self' && !selfCastIsUseful(actor, spell)) continue;
      const targetActorId = group === 'target.self' ? actor.actorId : target.actorId;
      const validation = validateTarget({
        targetingId: spell.targetingId,
        sourceActor: actor,
        targetActorId,
        target: null,
        floor: perception.floor,
        actors: input.state.actors,
        visibilityWords: perception.visibilityWords,
        illumination: perception.illumination,
        range: spell.range,
      });
      if (!validation.ok) continue;
      return {
        type: 'cast',
        actorId: actor.actorId,
        spellId: spell.id,
        targetActorId,
        weaveCost: spell.weaveCost,
        cost: spell.actionCost,
      };
    }
  }
  return null;
}
