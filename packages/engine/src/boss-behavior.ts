import type { BossEncounterContentEntry, CompiledContentPack, PopulationCombatModifiers } from '@woven-deep/content';
import type { ActorState } from './actor-model.js';
import { resolveEffectSequence } from './effects.js';
import { createFloorItem, createFloorLootFromTable } from './inventory.js';
import type { ActiveRun, DomainEvent, OpaqueId } from './model.js';
import type { BossPopulation } from './population-model.js';
import { compareCodeUnits } from './stable-json.js';

const ZERO_MODIFIERS: PopulationCombatModifiers = { accuracy: 0, defense: 0, damage: 0 };

function encounter(content: CompiledContentPack, encounterId: OpaqueId): BossEncounterContentEntry {
  const entry = content.entries.find((candidate) => candidate.id === encounterId);
  if (!entry || entry.kind !== 'encounter' || entry.model !== 'boss') {
    throw new Error(`internal invariant: boss encounter ${encounterId} does not exist`);
  }
  if (entry.maximumInstancesPerRun !== 1) {
    throw new Error(`internal invariant: boss encounter ${encounterId} must allow exactly one instance per run`);
  }
  return entry;
}

function replacePopulation(state: ActiveRun, population: BossPopulation): ActiveRun {
  return { ...state, populations: state.populations.map((candidate) => candidate.populationId === population.populationId
    ? population : candidate) };
}

function replaceActor(state: ActiveRun, actor: ActorState): ActiveRun {
  return { ...state, actors: state.actors.map((candidate) => candidate.actorId === actor.actorId ? actor : candidate) };
}

function currentPhaseMaximum(population: BossPopulation, definition: BossEncounterContentEntry['definition'], maxHealth: number): number {
  if (population.currentPhaseId === null) return maxHealth;
  const phase = definition.phases.find((candidate) => candidate.phaseId === population.currentPhaseId);
  if (!phase) throw new Error(`internal invariant: boss phase ${population.currentPhaseId} does not exist`);
  return Math.floor(maxHealth * phase.healthThresholdPercent / 100);
}

function synchronizeDeath(population: BossPopulation, actor: ActorState): BossPopulation {
  if (actor.health > 0 || !population.livingMemberIds.includes(actor.actorId)) return population;
  return { ...population, livingMemberIds: population.livingMemberIds.filter((id) => id !== actor.actorId),
    formerMemberIds: [...new Set([...population.formerMemberIds, actor.actorId])].sort(compareCodeUnits) };
}

function applyNewPhases(input: Readonly<{
  state: ActiveRun; content: CompiledContentPack; population: BossPopulation;
  boss: ActorState; definition: BossEncounterContentEntry['definition']; eventId: OpaqueId;
}>): Readonly<{ state: ActiveRun; population: BossPopulation; events: readonly DomainEvent[] }> {
  const crossed = new Set(input.population.crossedPhaseIds);
  const phases = input.definition.phases.filter((phase) => !crossed.has(phase.phaseId)
    && input.boss.health * 100 <= input.boss.maxHealth * phase.healthThresholdPercent);
  if (phases.length === 0) return { state: input.state, population: input.population, events: [] };

  // Resolve the complete authored effect sequence first. resolveEffectSequence validates every
  // effect before applying one, so a missing operation/reference cannot leave a partial phase.
  const effectResult = resolveEffectSequence({ effects: phases.flatMap((phase) => phase.effects),
    actors: input.state.actors, items: input.state.items, content: input.content,
    sourceActorId: input.boss.actorId, targetActorId: input.boss.actorId,
    effectsState: input.state.rng.effects, worldTime: input.state.worldTime, eventId: input.eventId,
    forceMoveDirection: { x: 1, y: 0 }, operations: {}, survival: input.state.survival,
    survivalActorId: input.state.hero.actorId });
  const finalPhase = phases.at(-1)!;
  const actors = effectResult.actors.map((actor) => actor.actorId === input.boss.actorId
    ? { ...actor, behaviorId: finalPhase.behaviorId } : actor);
  const phaseIds = [...input.population.crossedPhaseIds, ...phases.map((phase) => phase.phaseId)];
  const population: BossPopulation = { ...input.population, crossedPhaseIds: phaseIds,
    currentPhaseId: finalPhase.phaseId };
  const phaseEvents: DomainEvent[] = phases.map((phase) => ({ type: 'boss.phase-changed', eventId: input.eventId,
    populationId: population.populationId, actorId: population.actorId,
    encounterId: population.encounterId, phaseId: phase.phaseId }));
  return { population, state: { ...input.state, actors, items: effectResult.items,
    survival: effectResult.survival, rng: { ...input.state.rng, effects: effectResult.effectsState } },
    events: [...phaseEvents, ...effectResult.events] };
}

function recoverOnReentry(input: Readonly<{
  state: ActiveRun; population: BossPopulation; boss: ActorState;
  definition: BossEncounterContentEntry['definition']; eventId: OpaqueId;
}>): Readonly<{ state: ActiveRun; population: BossPopulation; events: readonly DomainEvent[] }> {
  if (input.population.lastFloorExitAt === null) return { state: input.state, population: input.population, events: [] };
  const population = { ...input.population, lastFloorExitAt: null };
  if (input.boss.health <= 0) return { state: input.state, population, events: [] };
  const elapsed = Math.max(0, input.state.activeFloorEnteredAt - input.population.lastFloorExitAt);
  const rateAmount = Math.floor(elapsed * input.definition.recoveryPerWorldTime * input.boss.maxHealth);
  const recoveryCap = Math.floor(input.boss.maxHealth * input.definition.recoveryCapPercent / 100);
  const phaseMaximum = currentPhaseMaximum(input.population, input.definition, input.boss.maxHealth);
  const amount = Math.max(0, Math.min(rateAmount, recoveryCap, phaseMaximum - input.boss.health));
  if (amount === 0) return { state: input.state, population, events: [] };
  const boss = { ...input.boss, health: input.boss.health + amount };
  const recovered: BossPopulation = { ...population,
    recoveryHistory: [...population.recoveryHistory, { at: input.state.activeFloorEnteredAt, amount }] };
  return { state: replaceActor(input.state, boss), population: recovered, events: [{ type: 'boss.recovered',
    eventId: input.eventId, populationId: population.populationId, actorId: population.actorId,
    encounterId: population.encounterId, amount, health: boss.health }] };
}

function createRewards(input: Readonly<{
  state: ActiveRun; content: CompiledContentPack; population: BossPopulation;
  boss: ActorState; definition: BossEncounterContentEntry['definition']; eventId: OpaqueId;
}>): Readonly<{ state: ActiveRun; population: BossPopulation; events: readonly DomainEvent[] }> {
  if (input.boss.health > 0 || input.population.rewardCreated) {
    return { state: input.state, population: input.population, events: [] };
  }
  const unique = createFloorItem({ content: input.content, contentId: input.definition.uniqueItemId,
    itemId: `item.reward.${input.population.populationId}.unique`, floorId: input.population.floorId,
    x: input.boss.x, y: input.boss.y });
  const loot = createFloorLootFromTable({ content: input.content, tableId: input.definition.enhancedLootTableId,
    state: input.state.rng.loot, itemIdPrefix: `item.reward.${input.population.populationId}.loot`,
    floorId: input.population.floorId, x: input.boss.x, y: input.boss.y });
  const created = [unique, ...loot.items];
  for (const item of created) if (input.state.items.some((existing) => existing.itemId === item.itemId)) {
    throw new Error(`internal invariant: boss reward item ${item.itemId} already exists without reward state`);
  }
  const population = { ...input.population, rewardCreated: true };
  const state = { ...input.state, items: [...input.state.items, ...created]
    .sort((left, right) => compareCodeUnits(left.itemId, right.itemId)),
    rng: { ...input.state.rng, loot: loot.state } };
  return { state, population, events: [{ type: 'boss.defeated', eventId: input.eventId,
    populationId: population.populationId, actorId: population.actorId, encounterId: population.encounterId },
  { type: 'boss.reward-created', eventId: input.eventId, populationId: population.populationId,
    actorId: population.actorId, encounterId: population.encounterId, uniqueItemId: unique.itemId,
    itemIds: created.map((item) => item.itemId) }] };
}

export function bossCombatModifiers(input: Readonly<{
  state: Pick<ActiveRun, 'actors' | 'populations'>; content: CompiledContentPack; actorId: OpaqueId;
}>): PopulationCombatModifiers {
  const actor = input.state.actors.find((candidate) => candidate.actorId === input.actorId);
  const population = input.state.populations.find((candidate) => candidate.populationId === actor?.populationId);
  if (!actor || actor.health <= 0 || population?.model !== 'boss' || population.currentPhaseId === null) return ZERO_MODIFIERS;
  const phase = encounter(input.content, population.encounterId).definition.phases
    .find((candidate) => candidate.phaseId === population.currentPhaseId);
  if (!phase) throw new Error(`internal invariant: boss phase ${population.currentPhaseId} does not exist`);
  return phase.modifiers;
}

export function advanceBosses(input: Readonly<{
  state: ActiveRun; content: CompiledContentPack; eventId: OpaqueId;
}>): Readonly<{ state: ActiveRun; events: readonly DomainEvent[] }> {
  const bossEncounterIds = input.state.populations.filter((population) => population.model === 'boss')
    .map((population) => population.encounterId);
  if (new Set(bossEncounterIds).size !== bossEncounterIds.length) {
    throw new Error('internal invariant: a boss encounter may create only one instance per run');
  }
  let state = input.state;
  const events: DomainEvent[] = [];
  for (const original of [...state.populations].sort((left, right) => compareCodeUnits(left.populationId, right.populationId))) {
    if (original.model !== 'boss') continue;
    const boss = state.actors.find((actor) => actor.actorId === original.actorId);
    if (!boss) throw new Error(`internal invariant: boss actor ${original.actorId} does not exist`);
    const definition = encounter(input.content, original.encounterId).definition;
    let population = synchronizeDeath(original, boss);
    if (population.floorId !== state.activeFloorId) {
      if (population.lastFloorExitAt === null) population = { ...population, lastFloorExitAt: state.worldTime };
      state = replacePopulation(state, population);
      continue;
    }
    const recovered = recoverOnReentry({ state, population, boss, definition, eventId: input.eventId });
    state = recovered.state; population = recovered.population; events.push(...recovered.events);
    const currentBoss = state.actors.find((actor) => actor.actorId === population.actorId)!;
    const phased = applyNewPhases({ state, content: input.content, population, boss: currentBoss,
      definition, eventId: input.eventId });
    state = phased.state; population = synchronizeDeath(phased.population,
      state.actors.find((actor) => actor.actorId === population.actorId)!); events.push(...phased.events);
    const reward = createRewards({ state, content: input.content, population,
      boss: state.actors.find((actor) => actor.actorId === population.actorId)!, definition, eventId: input.eventId });
    state = reward.state; population = reward.population; events.push(...reward.events);
    state = replacePopulation(state, population);
  }
  return { state, events };
}
