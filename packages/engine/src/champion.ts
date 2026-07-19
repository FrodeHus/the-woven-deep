import type {
  CompiledContentPack, FallenChampionTemplateContentEntry, MonsterContentEntry,
  PopulationCombatModifiers,
} from '@woven-deep/content';
import { emptyEquipment, type ActorState, type BaseAttributes } from './actor-model.js';
import { preservesRequiredRoutes } from './connectivity.js';
import { createFloorLootFromTable, createRecordedHeirloom, validateEchoLootGraph } from './inventory.js';
import type { ActiveRun, DomainEvent, FloorSnapshot, OpaqueId, Uint32State } from './model.js';
import type {
  ChampionPopulation, EchoPopulation, FallenHeroRunDecision, FallenHeroStandingSnapshot, PopulationInstance,
} from './population-model.js';
import { emptyActorBehaviorState } from './population-model.js';
import { replacePopulationList, sortedPopulations } from './population-runtime.js';
import { isNonZeroState, nextUint32 } from './random.js';
import { compareCodeUnits } from './stable-json.js';
import { boundedPrefixedDisplay, boundedSuffixedDisplay } from './display-text.js';

const UINT32_RANGE = 0x1_0000_0000;

function validateStandings(standings: readonly FallenHeroStandingSnapshot[]): void {
  if (standings.length > 10) throw new RangeError('fallen hero standings may contain at most ten records');
  const ids = new Set<string>();
  standings.forEach((standing, index) => {
    if (standing.rank !== index + 1) throw new RangeError('fallen hero standings must be ordered contiguously by rank');
    if (ids.has(standing.hallRecordId)) throw new RangeError(`duplicate fallen hero record ${standing.hallRecordId}`);
    ids.add(standing.hallRecordId);
  });
}

export function retainEchoCandidates(input: Readonly<{
  candidates: readonly FallenHeroStandingSnapshot[];
  rolls: readonly number[];
  chance: number;
  maximum: number;
}>): readonly OpaqueId[] {
  if (input.candidates.length !== input.rolls.length) throw new RangeError('every Echo candidate requires one roll');
  if (!Number.isFinite(input.chance) || input.chance < 0 || input.chance > 1) throw new RangeError('Echo chance is invalid');
  if (!Number.isSafeInteger(input.maximum) || input.maximum <= 0) throw new RangeError('Echo maximum must be positive');
  return input.candidates.map((candidate, index) => ({ candidate, roll: input.rolls[index]! }))
    .filter(({ roll }) => Number.isInteger(roll) && roll >= 0 && roll <= 0xffff_ffff
      && roll / UINT32_RANGE < input.chance)
    .sort((left, right) => left.roll - right.roll || left.candidate.rank - right.candidate.rank
      || compareCodeUnits(left.candidate.hallRecordId, right.candidate.hallRecordId))
    .slice(0, input.maximum).map(({ candidate }) => candidate.hallRecordId);
}

export function createFallenHeroRunDecisions(input: Readonly<{
  standings: readonly FallenHeroStandingSnapshot[];
  conqueredChampionRecordIds: readonly OpaqueId[];
  template: FallenChampionTemplateContentEntry;
  state: Uint32State;
}>): Readonly<{ decisions: readonly FallenHeroRunDecision[]; state: Uint32State }> {
  validateStandings(input.standings);
  assertEchoTemplateBoundaries(input.template, undefined);
  if (input.standings.length === 0) return { decisions: [], state: input.state };
  if (!isNonZeroState(input.state)) throw new RangeError('population gate random state must not be all zero');
  const echoes = input.standings.slice(1);
  let state = input.state;
  const rolls = echoes.map(() => { const step = nextUint32(state); state = step.state; return step.value; });
  const retainedEchoes = new Set(retainEchoCandidates({ candidates: echoes, rolls,
    chance: input.template.echoAppearanceChance, maximum: input.template.maximumEchoesPerRun }));
  const conquered = new Set(input.conqueredChampionRecordIds);
  return { state, decisions: input.standings.map((standing, index): FallenHeroRunDecision => index === 0
    ? { hallRecordId: standing.hallRecordId, rank: 1, role: 'champion', gateRoll: null,
      retained: !conquered.has(standing.hallRecordId), encountered: false, defeated: false }
    : { hallRecordId: standing.hallRecordId, rank: standing.rank, role: 'echo', gateRoll: rolls[index - 1]!,
      retained: retainedEchoes.has(standing.hallRecordId), encountered: false, defeated: false }) };
}

function monster(content: CompiledContentPack, template: FallenChampionTemplateContentEntry): MonsterContentEntry {
  const entry = content.entries.find((candidate) => candidate.id === template.fallbackMonsterId);
  if (!entry || entry.kind !== 'monster') throw new Error(`Champion fallback monster ${template.fallbackMonsterId} does not exist`);
  return entry;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export interface NormalizedFallenHero {
  readonly displayName: string;
  readonly glyph: string;
  readonly color: string;
  readonly monsterId: OpaqueId;
  readonly attributes: BaseAttributes;
  readonly health: number;
  readonly damageMaximum: number;
  readonly defenseMaximum: number;
  readonly accuracyMaximum: number;
  readonly equipmentContentIds: readonly OpaqueId[];
  readonly abilityIds: readonly OpaqueId[];
}

export function normalizeFallenHero(input: Readonly<{
  standing: FallenHeroStandingSnapshot;
  template: FallenChampionTemplateContentEntry;
  content: CompiledContentPack;
  role: 'champion' | 'echo';
}>): NormalizedFallenHero {
  const fallback = monster(input.content, input.template);
  const attributes = Object.fromEntries(Object.entries(input.standing.attributes)
    .map(([key, value]) => [key, clamp(value, 0, input.template.attributeMaximum)])) as unknown as BaseAttributes;
  const championHealth = clamp(fallback.health, input.template.minimumHealth, input.template.maximumHealth);
  const entries = new Map(input.content.entries.map((entry) => [entry.id, entry]));
  const rawDamage = fallback.damage.count * fallback.damage.sides + fallback.damage.bonus;
  const equipmentContentIds: OpaqueId[] = [];
  let equipmentAccuracy = 0;
  let equipmentDefense = 0;
  let equipmentDamage = 0;
  for (const id of input.standing.equippedItemContentIds) {
    const entry = entries.get(id);
    if (entry?.kind !== 'item' || entry.equipment === null) continue;
    const nextAccuracy = equipmentAccuracy + (entry.combat?.accuracy ?? 0);
    const nextDefense = equipmentDefense + (entry.combat?.defense ?? 0);
    const nextDamage = equipmentDamage + (entry.combat?.damage?.bonus ?? 0);
    if (fallback.accuracy + nextAccuracy <= 0 || fallback.defense + nextDefense <= 0 || rawDamage + nextDamage <= 0) continue;
    equipmentContentIds.push(id);
    equipmentAccuracy = nextAccuracy;
    equipmentDefense = nextDefense;
    equipmentDamage = nextDamage;
  }
  const championDamage = Math.min(input.template.damageMaximum,
    rawDamage + equipmentDamage);
  const championDefense = Math.min(input.template.attributeMaximum, fallback.defense + equipmentDefense);
  const championAccuracy = Math.min(input.template.attributeMaximum, fallback.accuracy + equipmentAccuracy);
  const echo = input.role === 'echo';
  const health = echo ? Math.min(championHealth - 1,
    Math.floor(championHealth * input.template.echoHealthPercent / 100)) : championHealth;
  const damageMaximum = echo ? Math.min(championDamage - 1,
    Math.floor(championDamage * input.template.echoDamagePercent / 100)) : championDamage;
  const defenseMaximum = echo ? Math.min(championDefense - 1,
    Math.floor(championDefense * input.template.echoDefensePercent / 100)) : championDefense;
  const accuracyMaximum = echo ? Math.min(championAccuracy - 1,
    Math.floor(championAccuracy * input.template.echoDamagePercent / 100)) : championAccuracy;
  const championAbilityIds = input.standing.signatureAbilityIds
    .filter((id) => entries.get(id)?.kind === 'spell').slice(0, input.template.abilityLimit);
  if (echo && championAbilityIds.length === 0) {
    throw new RangeError('Echo ability selection cannot be strictly weaker than the current Champion selection');
  }
  const abilityIds = echo ? championAbilityIds.slice(0,
    Math.min(input.template.echoAbilityLimit, Math.max(0, championAbilityIds.length - 1))) : championAbilityIds;
  return { displayName: echo ? boundedPrefixedDisplay('Echo of ', input.standing.heroName)
    : boundedSuffixedDisplay(input.standing.heroName, ", the Deep's Champion"), glyph: input.standing.portraitGlyph || fallback.glyph,
    color: fallback.color, monsterId: fallback.id, attributes, health: Math.max(1, health),
    damageMaximum: Math.max(0, damageMaximum), defenseMaximum: Math.max(0, defenseMaximum),
    accuracyMaximum: Math.max(0, accuracyMaximum), equipmentContentIds, abilityIds };
}

export function fallenHeroCombatModifiers(input: Readonly<{
  state: Pick<ActiveRun, 'actors' | 'populations' | 'fallenHeroStandings'>;
  content: CompiledContentPack;
  actorId: OpaqueId;
}>): PopulationCombatModifiers {
  const actor = input.state.actors.find((candidate) => candidate.actorId === input.actorId);
  const population = input.state.populations.find((candidate) => candidate.populationId === actor?.populationId);
  if (!actor || (population?.model !== 'champion' && population?.model !== 'echo')) {
    return { accuracy: 0, defense: 0, damage: 0 };
  }
  const definition = template(input.content);
  const standing = input.state.fallenHeroStandings.find((candidate) => candidate.hallRecordId === population.hallRecordId);
  if (!definition || !standing) throw new Error(`fallen hero combat state for ${actor.actorId} is incomplete`);
  const normalized = normalizeFallenHero({ standing, template: definition, content: input.content, role: population.model });
  const fallback = monster(input.content, definition);
  const rawDamageMaximum = fallback.damage.count * fallback.damage.sides + fallback.damage.bonus;
  return { accuracy: normalized.accuracyMaximum - fallback.accuracy,
    defense: normalized.defenseMaximum - fallback.defense,
    damage: normalized.damageMaximum - rawDamageMaximum };
}

export function assertEchoTemplateBoundaries(
  definition: FallenChampionTemplateContentEntry,
  content: CompiledContentPack | undefined,
): void {
  if (definition.echoAppearanceChance === 0) return;
  if (definition.echoAbilityLimit >= definition.abilityLimit) {
    throw new Error('Echo ability limit must be strictly below the Champion ability limit');
  }
  if (content === undefined) {
    if (definition.maximumHealth <= 1 || definition.damageMaximum <= 0 || definition.attributeMaximum <= 0) {
      throw new Error('Echo combat boundaries cannot be strictly weaker than Champion boundaries');
    }
    return;
  }
  const fallback = monster(content, definition);
  const health = clamp(fallback.health, definition.minimumHealth, definition.maximumHealth);
  const damage = Math.min(definition.damageMaximum,
    fallback.damage.count * fallback.damage.sides + fallback.damage.bonus);
  const defense = Math.min(definition.attributeMaximum, fallback.defense);
  const accuracy = Math.min(definition.attributeMaximum, fallback.accuracy);
  if (health <= 1 || damage <= 0 || defense <= 0 || accuracy <= 0) {
    throw new Error('Echo health, damage, defense, and accuracy boundaries cannot be strictly weaker');
  }
}

function template(content: CompiledContentPack): FallenChampionTemplateContentEntry | undefined {
  return content.entries.find((entry): entry is FallenChampionTemplateContentEntry => entry.kind === 'fallen-champion-template');
}

function requiredPoints(floor: FloorSnapshot): readonly Readonly<{ x: number; y: number }>[] {
  return [floor.stairUp, floor.stairDown,
    ...floor.placementSlots.filter((slot) => slot.kind === 'objective').map(({ x, y }) => ({ x, y }))]
    .filter((point): point is Readonly<{ x: number; y: number }> => point !== null);
}

function candidateSlots(floor: FloorSnapshot): readonly FloorSnapshot['placementSlots'][number][] {
  const vaultIds = new Set(floor.vaults.map((vault) => vault.placementId));
  const occupied = new Set(floor.entities.map((entity) => `${entity.x},${entity.y}`));
  return floor.placementSlots.filter((slot) => slot.kind === 'monster' && !slot.required
    && vaultIds.has(slot.vaultPlacementId)
    && slot.tags.some((tag) => tag === 'side-arena' || tag === 'fallen-hero' || tag === 'champion')
    && !occupied.has(`${slot.x},${slot.y}`))
    .sort((left, right) => compareCodeUnits(left.slotId, right.slotId));
}

export interface FallenHeroPlacement {
  readonly floor: FloorSnapshot;
  readonly actors: readonly ActorState[];
  readonly populations: readonly PopulationInstance[];
  readonly decisions: readonly FallenHeroRunDecision[];
}

export function placeFallenHeroEncounters(input: Readonly<{
  run: ActiveRun;
  floor: FloorSnapshot;
  content: CompiledContentPack;
}>): FallenHeroPlacement {
  const definition = template(input.content);
  if (!definition || input.run.fallenHeroDecisions.length === 0) {
    return { floor: input.floor, actors: [], populations: input.run.populations, decisions: input.run.fallenHeroDecisions };
  }
  let floor = input.floor;
  const createdActors: ActorState[] = [];
  const populations = [...input.run.populations];
  let slots = candidateSlots(floor);
  const selectedCells: Readonly<{ x: number; y: number }>[] = populations
    .filter((population): population is ChampionPopulation | EchoPopulation =>
      (population.model === 'champion' || population.model === 'echo')
      && population.floorId === floor.floorId)
    .flatMap((population) => {
      const actor = input.run.actors.find((candidate) => candidate.actorId === population.actorId);
      return actor && actor.health > 0 ? [{ x: actor.x, y: actor.y }] : [];
    });
  slots = slots.filter((slot) => !selectedCells.some((cell) => cell.x === slot.x && cell.y === slot.y));
  const decisions = input.run.fallenHeroDecisions.map((decision): FallenHeroRunDecision => {
    const standing = input.run.fallenHeroStandings.find((candidate) => candidate.hallRecordId === decision.hallRecordId);
    const exists = populations.some((population) => (population.model === 'champion' || population.model === 'echo')
      && population.hallRecordId === decision.hallRecordId);
    if (!standing || !decision.retained || decision.encountered || decision.defeated || exists
      || standing.deathDepth !== floor.depth || slots.length === 0) return decision;
    let normalized: NormalizedFallenHero;
    try {
      normalized = normalizeFallenHero({ standing, template: definition, content: input.content, role: decision.role });
    } catch (error) {
      if (decision.role === 'echo' && error instanceof RangeError && /ability.*strictly weaker/i.test(error.message)) {
        return decision;
      }
      throw error;
    }
    const index = slots.findIndex((slot) => preservesRequiredRoutes({ width: floor.width, height: floor.height,
      tiles: floor.tiles, requiredPoints: requiredPoints(floor),
      blockedPoints: [...selectedCells, { x: slot.x, y: slot.y }] }));
    if (index < 0) return decision;
    const slot = slots[index]!;
    selectedCells.push({ x: slot.x, y: slot.y });
    slots = slots.filter((_, slotIndex) => slotIndex !== index);
    const suffix = decision.role === 'champion' ? 'champion' : `echo-${decision.rank}`;
    const populationId = `population.fallen-${suffix}.${standing.hallRecordId}`;
    const actorId = `actor.${populationId}.001`;
    const fallback = monster(input.content, definition);
    const actor: ActorState = { actorId, contentId: normalized.monsterId, playerControlled: false,
      floorId: floor.floorId, x: slot.x, y: slot.y, attributes: normalized.attributes,
      health: normalized.health, maxHealth: normalized.health, energy: 100, speed: fallback.speed,
      reactionReady: true, disposition: 'hostile', awareActorIds: [], conditions: [], equipment: emptyEquipment(),
      behaviorId: fallback.behaviorId, behaviorState: emptyActorBehaviorState(), populationId,
      populationRoleId: null, populationPresentation: { name: normalized.displayName,
        glyph: normalized.glyph, color: normalized.color, leader: false } };
    const base = { populationId, encounterId: definition.id, floorId: floor.floorId,
      createdAt: input.run.worldTime, livingMemberIds: [actorId], formerMemberIds: [], actorId,
      hallRecordId: standing.hallRecordId, defeated: false };
    const population: ChampionPopulation | EchoPopulation = decision.role === 'champion'
      ? { ...base, model: 'champion', rank: 1, rewardCreated: false,
        equipmentContentIds: normalized.equipmentContentIds, abilityIds: normalized.abilityIds }
      : { ...base, model: 'echo', rank: standing.rank, lootCreated: false,
        equipmentContentIds: normalized.equipmentContentIds, abilityIds: normalized.abilityIds };
    createdActors.push(actor); populations.push(population);
    return decision;
  });
  populations.sort((left, right) => compareCodeUnits(left.populationId, right.populationId));
  createdActors.sort((left, right) => compareCodeUnits(left.actorId, right.actorId));
  return { floor, actors: createdActors, populations, decisions };
}

function synchronizeDeath(population: ChampionPopulation | EchoPopulation, actor: ActorState) {
  if (actor.health > 0 || population.defeated) return population;
  return { ...population, defeated: true, livingMemberIds: [], formerMemberIds: [actor.actorId] };
}

export function advanceFallenHeroEncounters(input: Readonly<{
  state: ActiveRun;
  content: CompiledContentPack;
  eventId: OpaqueId;
}>): Readonly<{ state: ActiveRun; events: readonly DomainEvent[] }> {
  const definition = template(input.content);
  if (!definition) return { state: input.state, events: [] };
  let state = input.state;
  const events: DomainEvent[] = [];
  for (const original of sortedPopulations(state.populations)) {
    if (original.model !== 'champion' && original.model !== 'echo') continue;
    const actor = state.actors.find((candidate) => candidate.actorId === original.actorId);
    const standing = state.fallenHeroStandings.find((candidate) => candidate.hallRecordId === original.hallRecordId);
    if (!actor || !standing) throw new Error(`fallen hero population ${original.populationId} is incomplete`);
    let population = synchronizeDeath(original, actor);
    if (!population.defeated || (population.model === 'champion' ? population.rewardCreated : population.lootCreated)) {
      if (population !== original) state = { ...state, populations: replacePopulationList(state.populations, population) };
      continue;
    }
    if (population.model === 'champion') {
      const reward = createRecordedHeirloom({ content: input.content, snapshot: standing.heirloom,
        equippedItemContentIds: standing.equippedItemContentIds, fallbackItemId: definition.fallbackItemId,
        itemId: `item.heirloom.${population.populationId}`, floorId: population.floorId, x: actor.x, y: actor.y });
      if (state.items.some((item) => item.itemId === reward.item.itemId)) {
        throw new Error(`Champion heirloom ${reward.item.itemId} exists without reward state`);
      }
      population = { ...population, rewardCreated: true };
      state = { ...state, items: [...state.items, reward.item].sort((left, right) => compareCodeUnits(left.itemId, right.itemId)) };
      events.push({ type: 'champion.defeated', eventId: input.eventId, populationId: population.populationId,
        actorId: actor.actorId, hallRecordId: standing.hallRecordId, rank: 1 },
      { type: 'champion.heirloom-created', eventId: input.eventId, populationId: population.populationId,
        actorId: actor.actorId, hallRecordId: standing.hallRecordId, rank: 1, itemId: reward.item.itemId,
        contentId: reward.item.contentId, originatingHallRecordId: standing.hallRecordId,
        displayName: reward.displayName, glyph: reward.glyph, color: reward.color, fallback: reward.fallback });
    } else {
      validateEchoLootGraph({ content: input.content, tableId: definition.echoLootTableId,
        recordedHeirloomContentId: standing.heirloom.contentId });
      const loot = createFloorLootFromTable({ content: input.content, tableId: definition.echoLootTableId,
        state: state.rng.loot, itemIdPrefix: `item.echo-loot.${population.populationId}`,
        floorId: population.floorId, x: actor.x, y: actor.y });
      if (loot.items.some((item) => item.contentId === standing.heirloom.contentId)) {
        throw new Error('Echo ordinary loot must not create its recorded heirloom');
      }
      population = { ...population, lootCreated: true };
      state = { ...state, items: [...state.items, ...loot.items].sort((left, right) => compareCodeUnits(left.itemId, right.itemId)),
        rng: { ...state.rng, loot: loot.state } };
      events.push({ type: 'echo.defeated', eventId: input.eventId, populationId: population.populationId,
        actorId: actor.actorId, hallRecordId: standing.hallRecordId, rank: standing.rank },
      { type: 'echo.loot-created', eventId: input.eventId, populationId: population.populationId,
        actorId: actor.actorId, hallRecordId: standing.hallRecordId, rank: standing.rank,
        itemIds: loot.items.map((item) => item.itemId) });
    }
    state = { ...state, populations: replacePopulationList(state.populations, population),
    fallenHeroDecisions: state.fallenHeroDecisions.map((decision) => decision.hallRecordId === standing.hallRecordId
      ? { ...decision, encountered: true, defeated: true } : decision) };
  }
  return { state, events };
}
