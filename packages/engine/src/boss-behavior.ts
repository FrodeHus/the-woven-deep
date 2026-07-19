import {
  BOSS_PHASE_EFFECT_IDS,
  type BossEncounterContentEntry,
  type CompiledContentPack,
  type PopulationCombatModifiers,
} from '@woven-deep/content';
import { withActor, type ActorState } from './actor-model.js';
import { applyEffectResult, resolveEffectSequence, type EffectOperations } from './effects.js';
import { consumeItemQuantityFromItems, createPopulationLoot } from './inventory.js';
import type { ActiveRun, DomainEvent, OpaqueId } from './model.js';
import type { BossPopulation } from './population-model.js';
import { replacePopulation, sortedPopulations, synchronizeDeath as sharedSynchronizeDeath } from './population-runtime.js';
import { entryById, requireEncounter, requireItem } from './content-index.js';
import { compareCodeUnits } from './stable-json.js';
import type { DungeonFeature } from './feature-model.js';
import { parseEffectParameters } from './parameter-contracts.js';

const ZERO_MODIFIERS: PopulationCombatModifiers = { accuracy: 0, defense: 0, damage: 0 };

function encounter(content: CompiledContentPack, encounterId: OpaqueId): BossEncounterContentEntry {
  const entry = requireEncounter(content, encounterId, 'boss');
  if (entry.maximumInstancesPerRun !== 1) {
    throw new Error(`internal invariant: boss encounter ${encounterId} must allow exactly one instance per run`);
  }
  return entry;
}

function currentPhaseMaximum(population: BossPopulation, definition: BossEncounterContentEntry['definition'], maxHealth: number): number {
  if (population.currentPhaseId === null) return maxHealth;
  const phase = definition.phases.find((candidate) => candidate.phaseId === population.currentPhaseId);
  if (!phase) throw new Error(`internal invariant: boss phase ${population.currentPhaseId} does not exist`);
  return Math.floor(maxHealth * phase.healthThresholdPercent / 100);
}

function synchronizeDeath(population: BossPopulation, actor: ActorState): BossPopulation {
  return sharedSynchronizeDeath(population, actor.health <= 0 ? [actor.actorId] : []);
}

function mutatedFeature(feature: DungeonFeature, state: string): DungeonFeature | null {
  if (feature.type === 'door' && state === 'door.open') return { ...feature, state: 'open' };
  if (feature.type === 'door' && state === 'door.closed') return { ...feature, state: 'closed' };
  if (feature.type === 'door' && state === 'door.locked') return { ...feature, state: 'locked' };
  if (feature.type === 'trap' && state === 'trap.armed') return { ...feature, state: 'armed' };
  if (feature.type === 'trap' && state === 'trap.disabled') return { ...feature, state: 'disabled' };
  if (feature.type === 'trap' && state === 'trap.spent') return { ...feature, state: 'spent' };
  if (feature.type === 'secret' && state === 'secret.hidden') return { ...feature, state: 'hidden' };
  if (feature.type === 'secret' && state === 'secret.revealed') return { ...feature, state: 'revealed' };
  return null;
}

function bossEffectOperations(input: Readonly<{
  content: CompiledContentPack; population: BossPopulation; heroId: OpaqueId;
  definition: BossEncounterContentEntry['definition'];
}>): EffectOperations {
  const arenaPlacements = (floors: ActiveRun['floors']) => {
    if (input.definition.vaultTags.length === 0) return null;
    const floor = floors.find((candidate) => candidate.floorId === input.population.floorId);
    if (!floor) throw new Error(`internal invariant: boss floor ${input.population.floorId} does not exist`);
    return floor.vaults.filter((placement) => {
      const vault = entryById(input.content, placement.vaultId);
      return vault?.kind === 'vault' && input.definition.vaultTags.every((tag) => vault.tags.includes(tag));
    });
  };
  const inArena = (x: number, y: number, floors: ActiveRun['floors']) => {
    const placements = arenaPlacements(floors);
    return placements === null || placements.some((placement) => x >= placement.x && y >= placement.y
      && x < placement.x + placement.width && y < placement.y + placement.height);
  };
  return {
    'effect.feature.mutate': (operation) => {
      const state = parseEffectParameters(operation.effect, 'effect.feature.mutate').state;
      let changed = 0;
      const events: DomainEvent[] = [];
      const features = operation.features.map((feature): DungeonFeature => {
        if (feature.floorId !== input.population.floorId || !inArena(feature.x, feature.y, operation.floors)) return feature;
        const updated = mutatedFeature(feature, state);
        if (updated === null) return feature;
        changed += 1;
        if (feature.type === 'door' && updated.type === 'door' && feature.state !== updated.state
          && (updated.state === 'open' || updated.state === 'closed')) {
          events.push({ type: updated.state === 'open' ? 'door.opened' : 'door.closed', eventId: operation.eventId,
            actorId: operation.sourceActorId, featureId: feature.featureId });
        }
        return updated;
      });
      if (changed === 0) throw new Error(`internal invariant: boss arena feature target for ${state} does not exist`);
      return { actors: operation.actors, features, events };
    },
    'effect.light.toggle': (operation) => {
      const enabled = parseEffectParameters(operation.effect, 'effect.light.toggle').enabled;
      let changed = 0;
      const events: DomainEvent[] = [];
      const items = operation.items.map((item) => {
        const owned = (item.location.type === 'backpack' || item.location.type === 'equipped')
          && item.location.actorId === operation.targetActorId;
        if (!owned || requireItem(input.content,item.contentId).light === null) return item;
        if (enabled && (item.fuel ?? 0) <= 0) throw new Error(`internal invariant: boss arena light ${item.itemId} has no fuel`);
        changed += 1;
        events.push({ type: 'item.light-toggled', eventId: operation.eventId, actorId: operation.targetActorId,
          itemId: item.itemId, enabled });
        return { ...item, enabled };
      });
      const placements = arenaPlacements(operation.floors);
      const placementIds = placements === null ? null : new Set(placements.map((placement) => placement.placementId));
      const floors = operation.floors.map((floor) => floor.floorId !== input.population.floorId ? floor : { ...floor,
        lights: floor.lights.map((light) => {
          if (light.location.type !== 'fixed' && light.location.actorId !== operation.targetActorId) return light;
          if (placementIds !== null && (light.vaultPlacementId === null || !placementIds.has(light.vaultPlacementId))) return light;
          changed += 1;
          return { ...light, enabled };
        }) });
      if (changed === 0) throw new Error('internal invariant: boss arena light target does not exist');
      return { actors: operation.actors, items, floors, events };
    },
    'effect.reveal': (operation) => {
      const radius = parseEffectParameters(operation.effect, 'effect.reveal').radius;
      const target = operation.actors.find((actor) => actor.actorId === operation.targetActorId)!;
      const events: DomainEvent[] = [];
      const features = operation.features.map((feature): DungeonFeature => {
        if (feature.type === 'door' || feature.floorId !== target.floorId
          || Math.max(Math.abs(feature.x - target.x), Math.abs(feature.y - target.y)) > radius
          || feature.discovery.discoveredByActorIds.includes(input.heroId)) return feature;
        events.push({ type: 'feature.revealed', eventId: operation.eventId,
          actorId: input.heroId, featureId: feature.featureId });
        const discoveredByActorIds = [...feature.discovery.discoveredByActorIds, input.heroId].sort(compareCodeUnits);
        const discovery = { ...feature.discovery, discoveredByActorIds };
        return feature.type === 'secret' ? { ...feature, state: 'revealed', discovery } : { ...feature, discovery };
      });
      return { actors: operation.actors, features, events };
    },
    'effect.fuel.transfer': (operation) => {
      const maximum = parseEffectParameters(operation.effect, 'effect.fuel.transfer').maximum;
      const owned = (item: typeof operation.items[number]) => (item.location.type === 'backpack'
        || item.location.type === 'equipped') && item.location.actorId === operation.targetActorId;
      const lights = operation.items.filter((item) => owned(item) && requireItem(input.content,item.contentId).light !== null)
        .sort((left, right) => compareCodeUnits(left.itemId, right.itemId));
      for (const lightItem of lights) {
        const light = requireItem(input.content,lightItem.contentId).light!;
        const capacity = light.fuelCapacity - (lightItem.fuel ?? 0);
        if (capacity <= 0) continue;
        const fuel = operation.items.filter((item) => item.location.type === 'backpack'
          && item.location.actorId === operation.targetActorId
          && requireItem(input.content,item.contentId).tags.some((tag) => light.fuelTags.includes(tag)))
          .sort((left, right) => compareCodeUnits(left.itemId, right.itemId))[0];
        if (!fuel) continue;
        const quantity = Math.min(maximum, capacity, fuel.quantity);
        const consumed = consumeItemQuantityFromItems({ items: operation.items, itemId: fuel.itemId, quantity });
        if (!consumed.ok) throw new Error(`internal invariant: boss arena fuel transfer failed with ${consumed.reason}`);
        const items = consumed.items.map((item) => item.itemId === lightItem.itemId
          ? { ...item, fuel: (lightItem.fuel ?? 0) + quantity } : item);
        return { actors: operation.actors, items, events: [{ type: 'item.refueled', eventId: operation.eventId,
          actorId: operation.targetActorId, itemId: lightItem.itemId, fuelItemId: fuel.itemId,
          quantity, fuel: (lightItem.fuel ?? 0) + quantity }] };
      }
      throw new Error('internal invariant: boss arena fuel target does not exist');
    },
  };
}

function applyNewPhases(input: Readonly<{
  state: ActiveRun; content: CompiledContentPack; population: BossPopulation;
  boss: ActorState; definition: BossEncounterContentEntry['definition']; eventId: OpaqueId;
}>): Readonly<{ state: ActiveRun; population: BossPopulation; events: readonly DomainEvent[] }> {
  const crossed = new Set(input.population.crossedPhaseIds);
  const phases = input.definition.phases.filter((phase) => !crossed.has(phase.phaseId)
    && input.boss.health * 100 <= input.boss.maxHealth * phase.healthThresholdPercent);
  if (phases.length === 0) return { state: input.state, population: input.population, events: [] };
  const unsupported = phases.flatMap((phase) => phase.effects)
    .find((effect) => !(BOSS_PHASE_EFFECT_IDS as readonly string[]).includes(effect.effectId));
  if (unsupported) {
    throw new Error(`internal invariant: boss phase effect ${unsupported.effectId} is unsupported`);
  }

  // Resolve the complete authored effect sequence first. resolveEffectSequence validates every
  // effect before applying one, so a missing operation/reference cannot leave a partial phase.
  const effectResult = resolveEffectSequence({ effects: phases.flatMap((phase) => phase.effects),
    actors: input.state.actors, items: input.state.items, features: input.state.features,
    floors: input.state.floors, content: input.content,
    sourceActorId: input.boss.actorId, targetActorId: input.boss.actorId,
    effectsState: input.state.rng.effects, worldTime: input.state.worldTime, eventId: input.eventId,
    forceMoveDirection: { x: 1, y: 0 }, operations: bossEffectOperations({ content: input.content,
      population: input.population, heroId: input.state.hero.actorId, definition: input.definition }), survival: input.state.survival,
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
  return { population, state: { ...applyEffectResult(input.state, effectResult), actors,
    features: effectResult.features, floors: effectResult.floors },
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
  return { state: withActor(input.state, boss), population: recovered, events: [{ type: 'boss.recovered',
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
  const { state, createdItems, unique, receipt } = createPopulationLoot({
    content: input.content, state: input.state, tableId: input.definition.enhancedLootTableId,
    itemIdPrefix: `item.reward.${input.population.populationId}.loot`,
    floorId: input.population.floorId, x: input.boss.x, y: input.boss.y,
    uniqueContentId: input.definition.uniqueItemId,
    uniqueItemId: `item.reward.${input.population.populationId}.unique`,
    existsError: (item) => `internal invariant: boss reward item ${item.itemId} already exists without reward state`,
  });
  const population = { ...input.population, rewardCreated: true, rewardReceipt: receipt };
  return { state, population, events: [{ type: 'boss.defeated', eventId: input.eventId,
    populationId: population.populationId, actorId: population.actorId, encounterId: population.encounterId },
  { type: 'boss.reward-created', eventId: input.eventId, populationId: population.populationId,
    actorId: population.actorId, encounterId: population.encounterId, uniqueItemId: unique!.itemId,
    itemIds: createdItems.map((item) => item.itemId) }] };
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
  for (const original of sortedPopulations(state.populations)) {
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
    if (currentBoss.health <= 0) {
      const reward = createRewards({ state, content: input.content, population,
        boss: currentBoss, definition, eventId: input.eventId });
      state = replacePopulation(reward.state, reward.population); events.push(...reward.events);
      continue;
    }
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
