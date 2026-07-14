import {
  boundedProduct,
  MAX_LOOT_CREATED_UNITS,
  type BalanceContentEntry,
  type CompiledContentPack,
  type MerchantEncounterContentEntry,
  type NpcContentEntry,
} from '@woven-deep/content';
import { emptyEquipment, type ActorState } from './actor-model.js';
import { projectLootGraph, rollLootFromProjection } from './inventory.js';
import type { ItemInstance } from './item-model.js';
import type { MerchantPopulation } from './merchant-model.js';
import type { ActiveRun, OpaqueId, Point, Uint32State } from './model.js';
import { emptyActorBehaviorState } from './population-model.js';
import { rollDie } from './random.js';

export interface MerchantMaterialization {
  readonly population: MerchantPopulation;
  readonly actor: ActorState;
  readonly items: readonly ItemInstance[];
  readonly nextMerchantStockState: Uint32State;
}

function npcDefinition(content: CompiledContentPack, id: OpaqueId): NpcContentEntry {
  const entry = content.entries.find((candidate) => candidate.id === id);
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

export function materializeMerchant(input: Readonly<{
  run: ActiveRun;
  content: CompiledContentPack;
  encounter: MerchantEncounterContentEntry;
  populationId: OpaqueId;
  floorId: OpaqueId;
  position: Point;
}>): MerchantMaterialization {
  const floor = input.run.floors.find((candidate) => candidate.floorId === input.floorId);
  if (!floor) throw new Error(`internal invariant: merchant floor ${input.floorId} does not exist`);
  const definition = input.encounter.definition;
  const npc = npcDefinition(input.content, definition.npcId);
  const balance = balanceDefinition(input.content);
  if (!Number.isSafeInteger(input.run.worldTime + definition.maximumLifetime)) {
    throw new RangeError('merchant lifetime would exceed safe world time');
  }
  if (!Number.isSafeInteger(definition.maximumStockRolls) || definition.maximumStockRolls <= 0) {
    throw new RangeError('merchant stock preflight: stock roll count must be a positive safe integer');
  }
  // Shared projection validates the complete authored graph (including the boss-unique
  // rejection: merchants must never stock boss uniques) and prunes depth-ineligible choices
  // before any merchant-stock RNG is consumed.
  const graph = projectLootGraph({
    content: input.content, rootTableId: definition.stockLootTableId,
    preflightLabel: 'merchant stock preflight',
    itemEligible: (item) => floor.depth >= item.minDepth && floor.depth <= item.maxDepth,
  });
  const root = graph.get(definition.stockLootTableId)!;
  if (root.choices.length === 0) {
    throw new Error(`internal invariant: merchant stock table ${definition.stockLootTableId} has no eligible choice at depth ${floor.depth}`);
  }
  if (boundedProduct(definition.maximumStockRolls, root.worstCreatedUnits, MAX_LOOT_CREATED_UNITS)
    > MAX_LOOT_CREATED_UNITS) {
    throw new RangeError(`merchant stock preflight: worst-case created items exceed runtime-safe limit ${MAX_LOOT_CREATED_UNITS}`);
  }

  let state = input.run.rng['merchant-stock'];
  const lifetimeRoll = rollDie(state, definition.maximumLifetime - definition.minimumLifetime + 1);
  state = lifetimeRoll.state;
  const rolledLifetime = definition.minimumLifetime + lifetimeRoll.value - 1;
  const stockRoll = rollDie(state, definition.maximumStockRolls - definition.minimumStockRolls + 1);
  state = stockRoll.state;
  const stockRolls = definition.minimumStockRolls + stockRoll.value - 1;
  const stock = rollLootFromProjection({
    content: input.content, tables: graph, tableId: definition.stockLootTableId,
    rootIterations: stockRolls, state,
    itemIdPrefix: `item.${input.populationId}.stock`,
    location: { type: 'merchant-stock', populationId: input.populationId },
  });
  state = stock.state;
  const items = stock.items;

  const services = definition.services.map((service) => {
    const useRoll = rollDie(state, service.maximumUses - service.minimumUses + 1); state = useRoll.state;
    return { serviceId: service.serviceId, basePrice: service.basePrice,
      remainingUses: service.minimumUses + useRoll.value - 1, tierIds: service.tierIds };
  });
  const actorId = `actor.${input.populationId}.001`;
  const actor: ActorState = {
    actorId, contentId: npc.id, playerControlled: false, floorId: input.floorId, ...input.position,
    attributes: npc.attributes, health: npc.health, maxHealth: npc.health,
    energy: balance.readinessThreshold,
    speed: npc.speed, reactionReady: true, disposition: 'neutral', awareActorIds: [], conditions: [],
    equipment: emptyEquipment(), behaviorId: npc.behaviorId, behaviorState: emptyActorBehaviorState(),
    populationId: input.populationId, populationRoleId: null,
    populationPresentation: { name: npc.name, glyph: npc.glyph, color: npc.color, leader: false },
  };
  const stockItemIds = items.map((item) => item.itemId).sort();
  const population: MerchantPopulation = {
    populationId: input.populationId, encounterId: input.encounter.id, floorId: input.floorId,
    createdAt: input.run.worldTime, livingMemberIds: [actorId], formerMemberIds: [], model: 'merchant',
    actorId, npcId: npc.id, factionId: npc.factionId, rolledLifetime,
    departureAt: input.run.worldTime + rolledLifetime, emittedWarningThresholds: [],
    initialStockItemIds: stockItemIds, stockItemIds, services, lifecycle: 'available', provoked: false,
    aggressionPenaltyApplied: false, deathPenaltyApplied: false, stockLossResolved: false,
    commerceBonusApplied: false,
  };
  return { population, actor, items, nextMerchantStockState: state };
}
