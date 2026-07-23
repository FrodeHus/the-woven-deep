import type {
  CompiledContentPack,
  DamageType,
  MonsterContentEntry,
  NpcContentEntry,
  PopulationCombatModifiers,
} from '@woven-deep/content';
import type { ActorState } from './actor-model.js';
import { entryById, requireItem } from './content-index.js';
import {
  applyPopulationCombatModifiers,
  composePopulationCombatModifiers,
  resolveAttack,
} from './combat.js';
import { deriveRunActorStats } from './stats.js';
import { groupCombatModifiers } from './group-behavior.js';
import { swarmCombatModifiers } from './swarm-behavior.js';
import { bossCombatModifiers } from './boss-behavior.js';
import { fallenHeroCombatModifiers } from './champion.js';
import type { ReactionAttackResult } from './reactions.js';
import type { ActiveRun, HeroState, OpaqueId, Uint32State } from './model.js';

export interface CombatProfile {
  readonly accuracy: number;
  readonly defense: number;
  readonly damage: Readonly<{ count: number; sides: number; bonus: number }>;
  readonly armor: number;
  readonly resistance: number;
  readonly immune: boolean;
}

export function monsterDefinition(
  content: CompiledContentPack,
  actor: ActorState,
): MonsterContentEntry | undefined {
  const entry = entryById(content, actor.contentId);
  return entry?.kind === 'monster' ? entry : undefined;
}

function npcDefinition(
  content: CompiledContentPack,
  actor: ActorState,
): NpcContentEntry | undefined {
  const entry = entryById(content, actor.contentId);
  return entry?.kind === 'npc' ? entry : undefined;
}

/**
 * Damage-type-aware mitigation for a single actor, independent of the melee/ranged combat
 * profile above (which only ever reports the `physical` resistance). Used by non-attack damage
 * sources such as condition tick effects (burn) that can carry any `DamageType`.
 */
export function damageMitigation(
  actor: ActorState,
  content: CompiledContentPack,
  damageType: DamageType,
): Readonly<{ armor: number; resistance: number; immune: boolean }> {
  const monster = monsterDefinition(content, actor);
  if (monster) {
    const resistance = monster.resistances[damageType];
    return { armor: monster.armor, resistance, immune: resistance >= 100 };
  }
  const npc = npcDefinition(content, actor);
  if (npc) {
    const resistance = npc.resistances[damageType];
    return { armor: npc.armor, resistance, immune: resistance >= 100 };
  }
  return { armor: 0, resistance: 0, immune: false };
}

type PopulationCombatModifierResolver = (
  input: Readonly<{
    state: Pick<ActiveRun, 'actors' | 'populations' | 'worldTime' | 'fallenHeroStandings'>;
    content: CompiledContentPack;
    actorId: OpaqueId;
  }>,
) => PopulationCombatModifiers;

// Each resolver returns ZERO modifiers unless the actor belongs to a population of its own model, so
// iterating the whole registry sums exactly one model's contribution. fallenHeroCombatModifiers serves
// both champion and echo actors, so a single `champion` entry covers both. Object.values preserves the
// group -> swarm -> boss -> fallen order that composePopulationCombatModifiers composes additively.
const populationCombatModifierResolvers: Record<
  'group' | 'swarm' | 'boss' | 'champion',
  PopulationCombatModifierResolver
> = {
  group: groupCombatModifiers,
  swarm: swarmCombatModifiers,
  boss: bossCombatModifiers,
  champion: fallenHeroCombatModifiers,
};

export function profile(
  actor: ActorState,
  content: CompiledContentPack,
  items: ActiveRun['items'] = [],
  actors: ActiveRun['actors'] = [actor],
  survival: ActiveRun['survival'] | undefined = undefined,
  populations: ActiveRun['populations'] = [],
  fallenHeroStandings: ActiveRun['fallenHeroStandings'] = [],
  worldTime = 0,
  hero: HeroState | undefined = undefined,
): CombatProfile {
  const monster = monsterDefinition(content, actor);
  const populationModifiers = composePopulationCombatModifiers(
    Object.values(populationCombatModifierResolvers).map((resolve) =>
      resolve({
        state: { actors, populations, worldTime, fallenHeroStandings },
        content,
        actorId: actor.actorId,
      }),
    ),
  );
  const npc = monster === undefined ? npcDefinition(content, actor) : undefined;
  if (npc)
    return applyPopulationCombatModifiers(
      {
        accuracy: npc.accuracy,
        defense: npc.defense,
        damage: npc.damage,
        armor: npc.armor,
        resistance: npc.resistances.physical,
        immune: npc.resistances.physical === 100,
      },
      populationModifiers,
    );
  if (monster)
    return applyPopulationCombatModifiers(
      {
        accuracy: monster.accuracy,
        defense: monster.defense,
        damage: monster.damage,
        armor: monster.armor,
        resistance: monster.resistances.physical,
        immune: monster.resistances.physical === 100,
      },
      populationModifiers,
    );
  const stats = deriveRunActorStats({
    state: { actors, items, survival: survival ?? { hungerStage: 'sated' }, hero },
    content,
    actor,
  });
  const equipped = items.filter(
    (item) => item.location.type === 'equipped' && item.location.actorId === actor.actorId,
  );
  const mainHandId = actor.equipment['main-hand'];
  const mainHand = mainHandId ? equipped.find((item) => item.itemId === mainHandId) : undefined;
  const weapon = mainHand ? requireItem(content, mainHand.contentId).combat : undefined;
  const damage =
    weapon?.damage && weapon.ammunitionTag === null
      ? { ...weapon.damage, bonus: weapon.damage.bonus + stats.meleeDamageBonus }
      : { count: 1, sides: 4, bonus: stats.meleeDamageBonus };
  const armor = equipped.reduce(
    (total, item) => total + (requireItem(content, item.contentId).combat?.armor ?? 0),
    0,
  );
  return applyPopulationCombatModifiers(
    {
      accuracy: stats.meleeAccuracy,
      defense: stats.defense,
      damage,
      armor,
      resistance: 0,
      immune: false,
    },
    populationModifiers,
  );
}

export function combat(
  input: Readonly<{
    actors: readonly ActorState[];
    combatState: Uint32State;
    attackerId: OpaqueId;
    targetActorId: OpaqueId;
    eventId: OpaqueId;
    content: CompiledContentPack;
    items: ActiveRun['items'];
    survival: ActiveRun['survival'];
    populations: ActiveRun['populations'];
    fallenHeroStandings: ActiveRun['fallenHeroStandings'];
    worldTime: number;
    hero: HeroState;
  }>,
): ReactionAttackResult {
  const attacker = input.actors.find((candidate) => candidate.actorId === input.attackerId);
  const target = input.actors.find((candidate) => candidate.actorId === input.targetActorId);
  if (!attacker || !target) throw new Error('internal invariant: combat actors must exist');
  const attack = profile(
    attacker,
    input.content,
    input.items,
    input.actors,
    input.survival,
    input.populations,
    input.fallenHeroStandings,
    input.worldTime,
    input.hero,
  );
  const defense = profile(
    target,
    input.content,
    input.items,
    input.actors,
    input.survival,
    input.populations,
    input.fallenHeroStandings,
    input.worldTime,
    input.hero,
  );
  return resolveAttack({
    ...input,
    accuracy: attack.accuracy,
    defense: defense.defense,
    damage: attack.damage,
    armor: defense.armor,
    resistance: defense.resistance,
    immune: defense.immune,
    damageType: 'physical',
  });
}
