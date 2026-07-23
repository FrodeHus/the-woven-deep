import type {
  CompiledContentPack,
  ConditionContentEntry,
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
 * Reads a condition's content definition directly via `entryById` (not `conditions.ts`'s
 * `conditionDefinition`) to avoid pulling `combat-profile.ts` into the
 * `conditions.ts -> attributes.ts -> stats.ts -> combat-profile.ts` import cycle.
 */
function conditionEntry(
  content: CompiledContentPack,
  conditionId: ActorState['conditions'][number]['conditionId'],
): ConditionContentEntry | undefined {
  const entry = entryById(content, conditionId);
  return entry?.kind === 'condition' ? entry : undefined;
}

/**
 * Sums the armor/resistance contributed by an actor's active timed/permanent conditions whose
 * content definition carries a `mitigation` block (e.g. a self-cast ward/shield). Conditions with
 * no `mitigation` block (every condition shipped today) contribute nothing, so this is a no-op
 * for all existing content.
 */
function conditionMitigationContribution(
  actor: ActorState,
  content: CompiledContentPack,
  damageType: DamageType,
): Readonly<{ armor: number; resistance: number }> {
  let armor = 0;
  let resistance = 0;
  for (const condition of actor.conditions) {
    const definition = conditionEntry(content, condition.conditionId);
    const mitigation = definition?.mitigation;
    if (!mitigation) continue;
    if (mitigation.armorPerStack) armor += mitigation.armorPerStack * condition.stacks;
    const resistancePerStack = mitigation.resistancePerStack?.[damageType];
    if (resistancePerStack) resistance += resistancePerStack * condition.stacks;
  }
  return { armor, resistance };
}

/**
 * Combines a base armor/resistance/immune reading with a condition mitigation contribution,
 * clamping the result to the ranges `resolveDamage` (`combat.ts`) requires (`armor >= 0`,
 * `-100 <= resistance <= 100`) so stacking wards can never produce a value that throws a
 * `RangeError` there. `immune` is derived from the UNCLAMPED total resistance so that e.g. two
 * stacking 60% fire wards (120% combined) correctly resolve to immune/0 damage rather than
 * clamping to a merely-strong 100% resistance.
 */
function clampMitigation(
  base: Readonly<{ armor: number; resistance: number; immune?: boolean }>,
  condition: Readonly<{ armor: number; resistance: number }>,
): Readonly<{ armor: number; resistance: number; immune: boolean }> {
  const totalArmor = base.armor + condition.armor;
  const totalResistance = base.resistance + condition.resistance;
  return {
    armor: Math.max(0, totalArmor),
    resistance: Math.max(-100, Math.min(100, totalResistance)),
    immune: Boolean(base.immune) || totalResistance >= 100,
  };
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
  const npc = monster === undefined ? npcDefinition(content, actor) : undefined;
  const base = monster
    ? { armor: monster.armor, resistance: monster.resistances[damageType] }
    : npc
      ? { armor: npc.armor, resistance: npc.resistances[damageType] }
      : { armor: 0, resistance: 0 };
  const conditionContribution = conditionMitigationContribution(actor, content, damageType);
  return clampMitigation(base, conditionContribution);
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
  // Direct attacks (melee/ranged) are hardcoded 'physical' (see `combat()` below), so only the
  // physical condition contribution applies here; elemental wards only matter to the tick/effect
  // path via `damageMitigation`. No existing condition carries a `mitigation` block, so this is a
  // no-op for all current content.
  const conditionContribution = conditionMitigationContribution(actor, content, 'physical');
  const npc = monster === undefined ? npcDefinition(content, actor) : undefined;
  if (npc) {
    const mitigation = clampMitigation(
      { armor: npc.armor, resistance: npc.resistances.physical },
      conditionContribution,
    );
    return applyPopulationCombatModifiers(
      {
        accuracy: npc.accuracy,
        defense: npc.defense,
        damage: npc.damage,
        ...mitigation,
      },
      populationModifiers,
    );
  }
  if (monster) {
    const mitigation = clampMitigation(
      { armor: monster.armor, resistance: monster.resistances.physical },
      conditionContribution,
    );
    return applyPopulationCombatModifiers(
      {
        accuracy: monster.accuracy,
        defense: monster.defense,
        damage: monster.damage,
        ...mitigation,
      },
      populationModifiers,
    );
  }
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
  const equippedArmor = equipped.reduce(
    (total, item) => total + (requireItem(content, item.contentId).combat?.armor ?? 0),
    0,
  );
  const mitigation = clampMitigation(
    { armor: equippedArmor, resistance: 0 },
    conditionContribution,
  );
  return applyPopulationCombatModifiers(
    {
      accuracy: stats.meleeAccuracy,
      defense: stats.defense,
      damage,
      ...mitigation,
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
