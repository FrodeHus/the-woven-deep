import {
  boundedProduct,
  MAX_LOOT_CREATED_UNITS,
  type BalanceContentEntry,
  type CompiledContentPack,
  type MerchantEncounterContentEntry,
  type NpcContentEntry,
} from '@woven-deep/content';
import { emptyEquipment, type ActorState } from './actor-model.js';
import { entryById, requireEncounter } from './content-index.js';
import { projectLootGraph, rollLootFromProjection } from './inventory.js';
import type { ItemInstance } from './item-model.js';
import type { MerchantPopulation } from './merchant-model.js';
import type { ActiveRun, DomainEvent, OpaqueId, Point, Uint32State } from './model.js';
import { emptyActorBehaviorState } from './population-model.js';
import { rollDie } from './random.js';

export interface MerchantMaterialization {
  readonly population: MerchantPopulation;
  readonly actor: ActorState;
  readonly items: readonly ItemInstance[];
  readonly nextMerchantStockState: Uint32State;
}

function npcDefinition(content: CompiledContentPack, id: OpaqueId): NpcContentEntry {
  const entry = entryById(content, id);
  if (!entry || entry.kind !== 'npc') {
    throw new Error(`internal invariant: merchant npc definition ${id} does not exist`);
  }
  return entry;
}

function balanceDefinition(content: CompiledContentPack): BalanceContentEntry {
  const entry = content.entries.find((candidate) => candidate.kind === 'balance');
  if (!entry) throw new Error('internal invariant: merchant balance definition does not exist');
  return entry;
}

function merchantEncounterDefinition(
  content: CompiledContentPack,
  encounterId: OpaqueId,
): MerchantEncounterContentEntry {
  return requireEncounter(content, encounterId, 'merchant');
}

export function materializeMerchant(
  input: Readonly<{
    run: ActiveRun;
    content: CompiledContentPack;
    encounter: MerchantEncounterContentEntry;
    populationId: OpaqueId;
    floorId: OpaqueId;
    position: Point;
  }>,
): MerchantMaterialization {
  const floor = input.run.floors.find((candidate) => candidate.floorId === input.floorId);
  if (!floor) throw new Error(`internal invariant: merchant floor ${input.floorId} does not exist`);
  const definition = input.encounter.definition;
  const npc = npcDefinition(input.content, definition.npcId);
  const balance = balanceDefinition(input.content);
  // A permanent (town) merchant never rolls (or declares) a lifetime; it restocks instead of
  // departing. Its stock is projected against the run's dungeon high-water mark rather than its
  // own floor depth (always the town, depth 0), so its pool widens as the hero descends -- the
  // same rule `restockMerchant` uses later. Non-permanent (travelling) merchants are completely
  // unaffected below: every roll they made before this task still happens in the same order.
  const minimumLifetime = definition.permanent ? undefined : definition.minimumLifetime!;
  const maximumLifetime = definition.permanent ? undefined : definition.maximumLifetime!;
  if (!definition.permanent && !Number.isSafeInteger(input.run.worldTime + maximumLifetime!)) {
    throw new RangeError('merchant lifetime would exceed safe world time');
  }
  if (!Number.isSafeInteger(definition.maximumStockRolls) || definition.maximumStockRolls <= 0) {
    throw new RangeError(
      'merchant stock preflight: stock roll count must be a positive safe integer',
    );
  }
  const effectiveDepth = definition.permanent
    ? Math.max(1, input.run.metrics.deepestDepth)
    : floor.depth;
  // Shared projection validates the complete authored graph (including the boss-unique
  // rejection: merchants must never stock boss uniques) and prunes depth-ineligible choices
  // before any merchant-stock RNG is consumed.
  const graph = projectLootGraph({
    content: input.content,
    rootTableId: definition.stockLootTableId,
    preflightLabel: 'merchant stock preflight',
    depth: effectiveDepth,
    itemEligible: (item) => effectiveDepth >= item.minDepth && effectiveDepth <= item.maxDepth,
  });
  const root = graph.get(definition.stockLootTableId)!;
  if (root.choices.length === 0) {
    throw new Error(
      `internal invariant: merchant stock table ${definition.stockLootTableId} has no eligible choice at depth ${effectiveDepth}`,
    );
  }
  if (
    boundedProduct(definition.maximumStockRolls, root.worstCreatedUnits, MAX_LOOT_CREATED_UNITS) >
    MAX_LOOT_CREATED_UNITS
  ) {
    throw new RangeError(
      `merchant stock preflight: worst-case created items exceed runtime-safe limit ${MAX_LOOT_CREATED_UNITS}`,
    );
  }

  let state = input.run.rng['merchant-stock'];
  let rolledLifetime = 0;
  if (!definition.permanent) {
    const lifetimeRoll = rollDie(state, maximumLifetime! - minimumLifetime! + 1);
    state = lifetimeRoll.state;
    rolledLifetime = minimumLifetime! + lifetimeRoll.value - 1;
  }
  const stockRoll = rollDie(state, definition.maximumStockRolls - definition.minimumStockRolls + 1);
  state = stockRoll.state;
  const stockRolls = definition.minimumStockRolls + stockRoll.value - 1;
  const stock = rollLootFromProjection({
    content: input.content,
    tables: graph,
    tableId: definition.stockLootTableId,
    rootIterations: stockRolls,
    state,
    itemIdPrefix: `item.${input.populationId}.stock`,
    location: { type: 'merchant-stock', populationId: input.populationId },
  });
  state = stock.state;
  const items = stock.items;

  const services = definition.services.map((service) => {
    const useRoll = rollDie(state, service.maximumUses - service.minimumUses + 1);
    state = useRoll.state;
    return {
      serviceId: service.serviceId,
      basePrice: service.basePrice,
      remainingUses: service.minimumUses + useRoll.value - 1,
      tierIds: service.tierIds,
    };
  });
  const actorId = `actor.${input.populationId}.001`;
  const actor: ActorState = {
    actorId,
    contentId: npc.id,
    playerControlled: false,
    floorId: input.floorId,
    ...input.position,
    attributes: npc.attributes,
    health: npc.health,
    maxHealth: npc.health,
    energy: balance.readinessThreshold,
    speed: npc.speed,
    reactionReady: true,
    disposition: 'neutral',
    awareActorIds: [],
    conditions: [],
    equipment: emptyEquipment(),
    // A permanent (town) merchant takes no turns: the town-step contract requires depth 0 to
    // never schedule a non-hero actor, so its behaviorId is forced null regardless of the
    // authored npc content (whose behaviorId is otherwise the shared travelling-merchant one).
    behaviorId: definition.permanent ? null : npc.behaviorId,
    behaviorState: emptyActorBehaviorState(),
    populationId: input.populationId,
    populationRoleId: null,
    populationPresentation: { name: npc.name, glyph: npc.glyph, color: npc.color, leader: false },
  };
  const stockItemIds = items.map((item) => item.itemId).sort();
  const population: MerchantPopulation = {
    populationId: input.populationId,
    encounterId: input.encounter.id,
    floorId: input.floorId,
    createdAt: input.run.worldTime,
    livingMemberIds: [actorId],
    formerMemberIds: [],
    model: 'merchant',
    actorId,
    npcId: npc.id,
    factionId: npc.factionId,
    rolledLifetime,
    departureAt: definition.permanent ? null : input.run.worldTime + rolledLifetime,
    emittedWarningThresholds: [],
    initialStockItemIds: stockItemIds,
    stockItemIds,
    services,
    lifecycle: 'available',
    provoked: false,
    aggressionPenaltyApplied: false,
    deathPenaltyApplied: false,
    stockLossResolved: false,
    commerceBonusApplied: false,
  };
  return { population, actor, items, nextMerchantStockState: state };
}

/**
 * Re-rolls a permanent merchant's stock from its encounter's loot table, consuming only the
 * `merchant-stock` stream. Used at balance restock milestones (see `floor-transition.ts`'s
 * descend path): removes every existing `merchant-stock`-located item owned by this population
 * and replaces them with a freshly rolled set, projected against the run's current dungeon
 * high-water mark (so the pool widens exactly as a fresh materialization's would). Reputation,
 * services, lifecycle, and identity (population/actor/faction ids) are all preserved untouched --
 * only `stockItemIds` (and the backing `items`) change. A departed or dead population is a no-op:
 * milestone restocks may still fire after such a (theoretically possible, never authored) state.
 */
export function restockMerchant(
  run: ActiveRun,
  input: Readonly<{
    content: CompiledContentPack;
    populationId: OpaqueId;
  }>,
): Readonly<{ state: ActiveRun; events: readonly DomainEvent[] }> {
  const population = run.populations.find(
    (candidate): candidate is MerchantPopulation =>
      candidate.model === 'merchant' && candidate.populationId === input.populationId,
  );
  if (!population)
    throw new Error(`internal invariant: merchant population ${input.populationId} does not exist`);
  if (population.lifecycle === 'departed' || population.lifecycle === 'dead') {
    return { state: run, events: [] };
  }
  const encounter = merchantEncounterDefinition(input.content, population.encounterId);
  const definition = encounter.definition;
  if (!definition.permanent) {
    throw new Error(
      `internal invariant: restockMerchant requires a permanent merchant encounter, got ${population.encounterId}`,
    );
  }
  const effectiveDepth = Math.max(1, run.metrics.deepestDepth);
  const graph = projectLootGraph({
    content: input.content,
    rootTableId: definition.stockLootTableId,
    preflightLabel: 'merchant restock preflight',
    depth: effectiveDepth,
    itemEligible: (item) => effectiveDepth >= item.minDepth && effectiveDepth <= item.maxDepth,
  });
  const root = graph.get(definition.stockLootTableId)!;
  if (root.choices.length === 0) {
    throw new Error(
      `internal invariant: merchant restock table ${definition.stockLootTableId} has no eligible choice at depth ${effectiveDepth}`,
    );
  }
  if (
    boundedProduct(definition.maximumStockRolls, root.worstCreatedUnits, MAX_LOOT_CREATED_UNITS) >
    MAX_LOOT_CREATED_UNITS
  ) {
    throw new RangeError(
      `merchant restock preflight: worst-case created items exceed runtime-safe limit ${MAX_LOOT_CREATED_UNITS}`,
    );
  }
  let state = run.rng['merchant-stock'];
  const stockRoll = rollDie(state, definition.maximumStockRolls - definition.minimumStockRolls + 1);
  state = stockRoll.state;
  const stockRolls = definition.minimumStockRolls + stockRoll.value - 1;
  // The restock item-id prefix is keyed by the run's current worldTime, which is strictly
  // increasing between any two restocks (a milestone can only be crossed by playing more turns
  // after the previous one), so it can never collide with the initial `...stock.NNNNNN` ids or
  // with a previous restock's ids -- including ones the hero has since carried into their own
  // backpack via a purchase.
  const stock = rollLootFromProjection({
    content: input.content,
    tables: graph,
    tableId: definition.stockLootTableId,
    rootIterations: stockRolls,
    state,
    itemIdPrefix: `item.${input.populationId}.restock-${run.worldTime}.stock`,
    location: { type: 'merchant-stock', populationId: input.populationId },
  });
  state = stock.state;
  const stockItemIds = stock.items.map((item) => item.itemId).sort();
  const items = [
    ...run.items.filter(
      (item) =>
        !(
          item.location.type === 'merchant-stock' &&
          item.location.populationId === input.populationId
        ),
    ),
    ...stock.items,
  ].sort((left, right) => (left.itemId < right.itemId ? -1 : left.itemId > right.itemId ? 1 : 0));
  const nextPopulation: MerchantPopulation = { ...population, stockItemIds };
  const nextState: ActiveRun = {
    ...run,
    rng: { ...run.rng, 'merchant-stock': state },
    items,
    populations: run.populations.map((candidate) =>
      candidate.populationId === input.populationId ? nextPopulation : candidate,
    ),
  };
  const event: DomainEvent = {
    type: 'merchant.restocked',
    eventId: `event.${input.populationId}.restock-${run.worldTime}`,
    populationId: input.populationId,
    actorId: population.actorId,
    stockItemIds,
  };
  return { state: nextState, events: [event] };
}
