import {
  boundedProduct,
  checkedTotalWithin,
  MAX_LOOT_CHOICE_QUANTITY,
  MAX_LOOT_CREATED_UNITS,
  MAX_LOOT_TABLE_ROLLS,
  MAX_LOOT_WEIGHT_TOTAL,
  type CompiledContentPack,
  type ItemContentEntry,
  type LootChoiceDefinition,
  type LootTableContentEntry,
  type MerchantEncounterContentEntry,
  type NpcContentEntry,
} from '@woven-deep/content';
import { emptyEquipment, type ActorState } from './actor-model.js';
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

interface EligibleTable {
  readonly table: LootTableContentEntry;
  readonly choices: readonly LootChoiceDefinition[];
  readonly worstCreatedItems: number;
}

function contentEntry<T extends CompiledContentPack['entries'][number]['kind']>(
  content: CompiledContentPack,
  id: OpaqueId,
  kind: T,
): Extract<CompiledContentPack['entries'][number], { kind: T }> {
  const entry = content.entries.find((candidate) => candidate.id === id);
  if (!entry || entry.kind !== kind) {
    throw new Error(`internal invariant: merchant ${kind} definition ${id} does not exist`);
  }
  return entry as Extract<CompiledContentPack['entries'][number], { kind: T }>;
}

/** Validates the complete authored stock graph and returns its depth-eligible projection. */
function eligibleStockGraph(
  content: CompiledContentPack,
  rootTableId: OpaqueId,
  depth: number,
  maximumStockRolls: number,
): ReadonlyMap<OpaqueId, EligibleTable> {
  if (!Number.isSafeInteger(maximumStockRolls) || maximumStockRolls <= 0) {
    throw new RangeError('merchant stock preflight: stock roll count must be a positive safe integer');
  }
  const memo = new Map<OpaqueId, EligibleTable>();
  const visit = (tableId: OpaqueId, trail: readonly OpaqueId[]): EligibleTable => {
    const memoized = memo.get(tableId);
    if (memoized) return memoized;
    if (trail.includes(tableId)) {
      throw new Error(`internal invariant: merchant stock table cycle ${[...trail, tableId].join(' -> ')}`);
    }
    const table = contentEntry(content, tableId, 'loot-table') as LootTableContentEntry;
    if (!Number.isSafeInteger(table.rolls) || table.rolls <= 0 || table.rolls > MAX_LOOT_TABLE_ROLLS) {
      throw new RangeError(`merchant stock preflight: roll count exceeds runtime-safe limit ${MAX_LOOT_TABLE_ROLLS}`);
    }
    if (table.choices.some((choice) => !Number.isSafeInteger(choice.weight) || choice.weight <= 0)
      || !checkedTotalWithin(table.choices.map((choice) => choice.weight), MAX_LOOT_WEIGHT_TOTAL)) {
      throw new RangeError('merchant stock preflight: choice weight total exceeds rollDie maximum 2^32');
    }
    const choices: LootChoiceDefinition[] = [];
    let worstChoice = 0;
    for (const choice of table.choices) {
      if (!Number.isSafeInteger(choice.maximumQuantity) || choice.maximumQuantity <= 0
        || choice.maximumQuantity > MAX_LOOT_CHOICE_QUANTITY) {
        throw new RangeError(`merchant stock preflight: choice quantity exceeds runtime-safe limit ${MAX_LOOT_CHOICE_QUANTITY}`);
      }
      if (!Number.isSafeInteger(choice.minimumQuantity) || choice.minimumQuantity <= 0
        || choice.minimumQuantity > choice.maximumQuantity) {
        throw new RangeError('merchant stock preflight: choice quantity range is invalid');
      }
      if ((choice.contentId === null) === (choice.lootTableId === null)) {
        throw new Error(`internal invariant: merchant stock table ${tableId} choice must have exactly one target`);
      }
      if (choice.contentId !== null) {
        const item = contentEntry(content, choice.contentId, 'item') as ItemContentEntry;
        if (choice.maximumQuantity > item.stackLimit) {
          throw new RangeError(`merchant stock preflight: choice quantity exceeds item stack limit ${item.stackLimit}`);
        }
        if (depth >= item.minDepth && depth <= item.maxDepth) {
          choices.push(choice);
          worstChoice = Math.max(worstChoice, 1);
        }
        continue;
      }
      const child = visit(choice.lootTableId!, [...trail, tableId]);
      if (child.choices.length > 0) {
        choices.push(choice);
        worstChoice = Math.max(worstChoice,
          boundedProduct(choice.maximumQuantity, child.worstCreatedItems, MAX_LOOT_CREATED_UNITS));
      }
    }
    const projected = {
      table,
      choices,
      worstCreatedItems: boundedProduct(table.rolls, worstChoice, MAX_LOOT_CREATED_UNITS),
    };
    memo.set(tableId, projected);
    return projected;
  };
  const root = visit(rootTableId, []);
  if (root.choices.length === 0) {
    throw new Error(`internal invariant: merchant stock table ${rootTableId} has no eligible choice at depth ${depth}`);
  }
  const worst = boundedProduct(maximumStockRolls, root.worstCreatedItems, MAX_LOOT_CREATED_UNITS);
  if (worst > MAX_LOOT_CREATED_UNITS) {
    throw new RangeError(`merchant stock preflight: worst-case created items exceed runtime-safe limit ${MAX_LOOT_CREATED_UNITS}`);
  }
  return memo;
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
  const npc = contentEntry(input.content, definition.npcId, 'npc') as NpcContentEntry;
  if (!Number.isSafeInteger(input.run.worldTime + definition.maximumLifetime)) {
    throw new RangeError('merchant lifetime would exceed safe world time');
  }
  const graph = eligibleStockGraph(input.content, definition.stockLootTableId, floor.depth,
    definition.maximumStockRolls);

  let state = input.run.rng['merchant-stock'];
  const lifetimeRoll = rollDie(state, definition.maximumLifetime - definition.minimumLifetime + 1);
  state = lifetimeRoll.state;
  const rolledLifetime = definition.minimumLifetime + lifetimeRoll.value - 1;
  const stockRoll = rollDie(state, definition.maximumStockRolls - definition.minimumStockRolls + 1);
  state = stockRoll.state;
  const stockRolls = definition.minimumStockRolls + stockRoll.value - 1;
  const items: ItemInstance[] = [];
  const resolve = (tableId: OpaqueId): void => {
    const eligible = graph.get(tableId)!;
    const totalWeight = eligible.choices.reduce((sum, choice) => sum + choice.weight, 0);
    for (let roll = 0; roll < eligible.table.rolls; roll += 1) {
      const selection = rollDie(state, totalWeight); state = selection.state;
      let cursor = selection.value;
      const choice = eligible.choices.find((candidate) => (cursor -= candidate.weight) <= 0)!;
      const quantityRoll = rollDie(state, choice.maximumQuantity - choice.minimumQuantity + 1);
      state = quantityRoll.state;
      const quantity = choice.minimumQuantity + quantityRoll.value - 1;
      if (choice.lootTableId !== null) {
        for (let count = 0; count < quantity; count += 1) resolve(choice.lootTableId);
        continue;
      }
      const item = contentEntry(input.content, choice.contentId!, 'item') as ItemContentEntry;
      const itemId = `item.${input.populationId}.stock.${String(items.length + 1).padStart(6, '0')}`;
      items.push({ itemId, contentId: item.id, quantity, condition: 100, enchantment: null,
        identified: item.identification.mode === 'known', charges: null,
        fuel: item.light?.fuelCapacity ?? null, enabled: item.light === null ? null : false,
        location: { type: 'merchant-stock', populationId: input.populationId } });
    }
  };
  for (let roll = 0; roll < stockRolls; roll += 1) resolve(definition.stockLootTableId);

  const services = definition.services.map((service) => {
    const useRoll = rollDie(state, service.maximumUses - service.minimumUses + 1); state = useRoll.state;
    return { serviceId: service.serviceId, basePrice: service.basePrice,
      remainingUses: service.minimumUses + useRoll.value - 1, tierIds: service.tierIds };
  });
  const actorId = `actor.${input.populationId}.001`;
  const actor: ActorState = {
    actorId, contentId: npc.id, playerControlled: false, floorId: input.floorId, ...input.position,
    attributes: npc.attributes, health: npc.health, maxHealth: npc.health,
    energy: contentEntry(input.content, input.content.entries.find((entry) => entry.kind === 'balance')!.id,
      'balance').readinessThreshold,
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
