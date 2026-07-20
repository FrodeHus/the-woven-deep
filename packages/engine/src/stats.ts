import type { CompiledContentPack } from '@woven-deep/content';
import { balanceEntry } from './actions.js';
import type { ActorState } from './actor-model.js';
import { deriveActorStats, type DerivedActorStats } from './attributes.js';
import { conditionModifiers } from './conditions.js';
import { equipmentModifiers } from './equipment.js';
import type { ActiveRun, HeroState } from './model.js';
import { hungerModifiers } from './survival.js';
import type { HungerStage } from './survival-model.js';

export interface RunActorStatsInput {
  readonly state: Readonly<{
    actors: ActiveRun['actors'];
    items: ActiveRun['items'];
    survival: Readonly<{ hungerStage: HungerStage }>;
    hero: HeroState | undefined;
  }>;
  readonly content: CompiledContentPack;
  readonly actor: ActorState;
}

/**
 * Derives an actor's combat stats within a run: base attributes plus the four modifier sources
 * (equipment, conditions, hunger, and — only when the actor is the run's hero — the hero stat
 * modifiers).
 */
export function deriveRunActorStats(input: RunActorStatsInput): DerivedActorStats {
  const balance = balanceEntry(input.content);
  return deriveActorStats({
    attributes: input.actor.attributes,
    formulas: balance.formulas,
    equipmentModifiers: equipmentModifiers({
      run: input.state,
      content: input.content,
      actorId: input.actor.actorId,
    }).map((source) => source.modifiers),
    conditionModifiers: [
      ...conditionModifiers(input.actor, input.content),
      hungerModifiers({ stage: input.state.survival.hungerStage, balance }),
    ],
    heroModifiers:
      input.state.hero !== undefined && input.actor.actorId === input.state.hero.actorId
        ? [input.state.hero.statModifiers]
        : [],
  });
}
