import {
  boundedProduct, checkedTotalWithin, DERIVED_STAT_NAMES, MAX_LOOT_CHOICE_QUANTITY,
  MAX_LOOT_CREATED_UNITS, MAX_LOOT_TABLE_ROLLS, MAX_LOOT_WEIGHT_TOTAL,
  type CompiledContentPack, type ItemContentEntry, type LootChoiceDefinition,
  type LootTableContentEntry,
} from '@woven-deep/content';
import { actorById } from './actor-model.js';
import type { ItemInstance } from './item-model.js';
import type { ActiveRun, OpaqueId, Uint32State } from './model.js';
import type { RecordedHeirloomSnapshot } from './population-model.js';
import { stableJson } from './stable-json.js';
import { boundedDisplayText } from './display-text.js';
import { rollDie } from './random.js';

export type InventoryFailureReason = 'inventory.full' | 'item.missing' | 'item.unavailable'
  | 'item.quantity' | 'item.incompatible' | 'item.id-conflict';

export type InventoryTransition =
  | Readonly<{ ok: true; run: ActiveRun; items: readonly ItemInstance[] }>
  | Readonly<{ ok: false; reason: InventoryFailureReason }>;

function failure(reason: InventoryFailureReason): InventoryTransition {
  return { ok: false, reason };
}

function success(run: ActiveRun, items: readonly ItemInstance[]): InventoryTransition {
  const sorted = [...items].sort((left, right) => left.itemId < right.itemId ? -1 : left.itemId > right.itemId ? 1 : 0);
  return { ok: true, run: { ...run, items: sorted }, items: sorted };
}

function positiveQuantity(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function itemDefinition(content: CompiledContentPack, contentId: OpaqueId): ItemContentEntry {
  const entry = content.entries.find((candidate) => candidate.id === contentId);
  if (!entry || entry.kind !== 'item') throw new Error(`internal invariant: item definition ${contentId} does not exist`);
  return entry;
}

function lootTable(content: CompiledContentPack, tableId: OpaqueId): LootTableContentEntry {
  const entry = content.entries.find((candidate) => candidate.id === tableId);
  if (!entry || entry.kind !== 'loot-table') {
    throw new Error(`internal invariant: loot table ${tableId} does not exist`);
  }
  return entry;
}

export interface ProjectedLootTable {
  readonly table: LootTableContentEntry;
  /** Choices that survive eligibility filtering (all authored choices when no filter is given). */
  readonly choices: readonly LootChoiceDefinition[];
  /** Worst-case created units for one resolution of this table. */
  readonly worstCreatedUnits: number;
}

/**
 * Validates a complete loot graph before consuming RNG or creating any item and returns its
 * projection, keyed by table id.
 *
 * `itemEligible` restricts direct-item choices (merchant stock filters by floor depth).
 * Every authored choice is validated, but ineligible direct choices — and nested choices whose
 * child table keeps no eligible choice — are pruned from the projection so resolution never
 * selects them. Two semantics are deliberately shared by every caller:
 * - Worst-case accounting counts item units (`maximumQuantity` per direct choice), not stack
 *   instances, so ordinary loot and merchant stock bound the same runtime cost.
 * - Graphs reaching guaranteed boss-unique items are rejected everywhere; merchants must never
 *   stock boss uniques, exactly as ordinary loot must never drop them.
 */
export function projectLootGraph(input: Readonly<{
  content: CompiledContentPack;
  rootTableId: OpaqueId;
  /** Error-message prefix; defaults to the ordinary-loot 'loot preflight'. */
  preflightLabel?: string;
  itemEligible?: (item: ItemContentEntry) => boolean;
}>): ReadonlyMap<OpaqueId, ProjectedLootTable> {
  const { content, itemEligible } = input;
  const label = input.preflightLabel ?? 'loot preflight';
  const memo = new Map<OpaqueId, ProjectedLootTable>();
  const bossUniqueIds = new Set(content.entries.filter((entry) => entry.kind === 'encounter' && entry.model === 'boss')
    .map((entry) => entry.definition.uniqueItemId));
  const visit = (tableId: OpaqueId, trail: readonly OpaqueId[]): ProjectedLootTable => {
    const memoized = memo.get(tableId);
    if (memoized !== undefined) return memoized;
    if (trail.includes(tableId)) {
      throw new Error(`internal invariant: loot table cycle ${[...trail, tableId].join(' -> ')}`);
    }
    const table = lootTable(content, tableId);
    if (!Number.isSafeInteger(table.rolls) || table.rolls <= 0 || table.rolls > MAX_LOOT_TABLE_ROLLS) {
      throw new RangeError(`${label}: roll count exceeds runtime-safe limit ${MAX_LOOT_TABLE_ROLLS}`);
    }
    if (table.choices.some((choice) => !Number.isSafeInteger(choice.weight) || choice.weight <= 0)
      || !checkedTotalWithin(table.choices.map((choice) => choice.weight), MAX_LOOT_WEIGHT_TOTAL)) {
      throw new RangeError(`${label}: choice weight total exceeds rollDie maximum 2^32`);
    }
    const choices: LootChoiceDefinition[] = [];
    let worstChoice = 0;
    for (const choice of table.choices) {
      if (!Number.isSafeInteger(choice.maximumQuantity) || choice.maximumQuantity <= 0
        || choice.maximumQuantity > MAX_LOOT_CHOICE_QUANTITY) {
        throw new RangeError(`${label}: choice quantity exceeds runtime-safe limit ${MAX_LOOT_CHOICE_QUANTITY}`);
      }
      if (!Number.isSafeInteger(choice.minimumQuantity) || choice.minimumQuantity <= 0
        || choice.minimumQuantity > choice.maximumQuantity) {
        throw new RangeError(`${label}: choice quantity range is invalid`);
      }
      if ((choice.contentId === null) === (choice.lootTableId === null)) {
        throw new Error(`internal invariant: loot table ${tableId} choice must have exactly one target`);
      }
      const directItem = choice.contentId === null ? null : itemDefinition(content, choice.contentId);
      if (directItem && choice.maximumQuantity > directItem.stackLimit) {
        throw new RangeError(`${label}: choice quantity exceeds item stack limit ${directItem.stackLimit}`);
      }
      if (choice.contentId !== null && bossUniqueIds.has(choice.contentId)) {
        throw new Error(`${label}: guaranteed boss-unique item ${choice.contentId} cannot appear in ordinary loot`);
      }
      if (directItem !== null) {
        if (itemEligible === undefined || itemEligible(directItem)) {
          choices.push(choice);
          worstChoice = Math.max(worstChoice,
            boundedProduct(choice.maximumQuantity, 1, MAX_LOOT_CREATED_UNITS));
        }
        continue;
      }
      const child = visit(choice.lootTableId!, [...trail, tableId]);
      if (itemEligible === undefined || child.choices.length > 0) {
        choices.push(choice);
        worstChoice = Math.max(worstChoice,
          boundedProduct(choice.maximumQuantity, child.worstCreatedUnits, MAX_LOOT_CREATED_UNITS));
      }
    }
    const worst = boundedProduct(table.rolls, worstChoice, MAX_LOOT_CREATED_UNITS);
    if (worst > MAX_LOOT_CREATED_UNITS) {
      throw new RangeError(`${label}: worst-case created units exceed runtime-safe limit ${MAX_LOOT_CREATED_UNITS}`);
    }
    const projected: ProjectedLootTable = { table, choices, worstCreatedUnits: worst };
    memo.set(tableId, projected);
    return projected;
  };
  visit(input.rootTableId, []);
  return memo;
}

/** Validates a complete loot graph before consuming RNG or creating any item. */
function validateLootGraph(content: CompiledContentPack, rootTableId: OpaqueId): void {
  projectLootGraph({ content, rootTableId });
}

/**
 * Resolves a projected loot graph into item instances, consuming only the supplied stream.
 * Item ids continue the shared `${itemIdPrefix}.NNNNNN` sequence across `rootIterations`.
 */
export function rollLootFromProjection(input: Readonly<{
  content: CompiledContentPack;
  tables: ReadonlyMap<OpaqueId, ProjectedLootTable>;
  tableId: OpaqueId;
  rootIterations?: number;
  state: Uint32State;
  itemIdPrefix: OpaqueId;
  location: ItemInstance['location'];
}>): Readonly<{ items: readonly ItemInstance[]; state: Uint32State }> {
  let state = input.state;
  const items: ItemInstance[] = [];
  const resolve = (tableId: OpaqueId): void => {
    const projected = input.tables.get(tableId);
    if (!projected) throw new Error(`internal invariant: loot table ${tableId} is not part of the projected graph`);
    const totalWeight = projected.choices.reduce((sum, choice) => sum + choice.weight, 0);
    for (let roll = 0; roll < projected.table.rolls; roll += 1) {
      const selected = rollDie(state, totalWeight); state = selected.state;
      let cursor = selected.value;
      const choice = projected.choices.find((candidate) => (cursor -= candidate.weight) <= 0)!;
      const quantityRoll = rollDie(state, choice.maximumQuantity - choice.minimumQuantity + 1); state = quantityRoll.state;
      const quantity = choice.minimumQuantity + quantityRoll.value - 1;
      if (choice.lootTableId !== null) {
        for (let count = 0; count < quantity; count += 1) resolve(choice.lootTableId);
        continue;
      }
      const definition = itemDefinition(input.content, choice.contentId!);
      items.push({ itemId: `${input.itemIdPrefix}.${String(items.length + 1).padStart(6, '0')}`,
        contentId: definition.id, quantity, condition: 100, enchantment: null,
        identified: definition.identification.mode === 'known', charges: null,
        fuel: definition.light?.fuelCapacity ?? null, enabled: definition.light === null ? null : false,
        location: input.location });
    }
  };
  for (let iteration = 0; iteration < (input.rootIterations ?? 1); iteration += 1) resolve(input.tableId);
  return { items, state };
}

export function validateEchoLootGraph(input: Readonly<{
  content: CompiledContentPack;
  tableId: OpaqueId;
  recordedHeirloomContentId: OpaqueId;
}>): void {
  validateLootGraph(input.content, input.tableId);
  const bossUniqueIds = new Set(input.content.entries.filter((entry) => entry.kind === 'encounter' && entry.model === 'boss')
    .map((entry) => entry.definition.uniqueItemId));
  const visited = new Set<OpaqueId>();
  const visit = (tableId: OpaqueId): void => {
    if (visited.has(tableId)) return;
    visited.add(tableId);
    const table = lootTable(input.content, tableId);
    for (const choice of table.choices) {
      if (choice.contentId !== null) {
        if (choice.contentId === input.recordedHeirloomContentId) {
          throw new Error(`Echo loot graph ${input.tableId} reaches recorded heirloom ${choice.contentId}; Echo rewards must be ordinary`);
        }
        if (bossUniqueIds.has(choice.contentId)) {
          throw new Error(`Echo loot graph ${input.tableId} reaches guaranteed boss-unique item ${choice.contentId}; Echo rewards must be ordinary`);
        }
      } else if (choice.lootTableId !== null) visit(choice.lootTableId);
    }
  };
  visit(input.tableId);
}

export function createFloorLootFromTable(input: Readonly<{
  content: CompiledContentPack;
  tableId: OpaqueId;
  state: Uint32State;
  itemIdPrefix: OpaqueId;
  floorId: OpaqueId;
  x: number;
  y: number;
}>): Readonly<{ items: readonly ItemInstance[]; state: Uint32State }> {
  const tables = projectLootGraph({ content: input.content, rootTableId: input.tableId });
  if (!Number.isSafeInteger(input.x) || input.x < 0 || !Number.isSafeInteger(input.y) || input.y < 0) {
    throw new RangeError('loot floor position must use non-negative safe integers');
  }
  return rollLootFromProjection({
    content: input.content, tables, tableId: input.tableId, state: input.state,
    itemIdPrefix: input.itemIdPrefix,
    location: { type: 'floor', floorId: input.floorId, x: input.x, y: input.y },
  });
}

export function createFloorItem(input: Readonly<{
  content: CompiledContentPack; contentId: OpaqueId; itemId: OpaqueId;
  floorId: OpaqueId; x: number; y: number;
}>): ItemInstance {
  const definition = itemDefinition(input.content, input.contentId);
  return { itemId: input.itemId, contentId: definition.id, quantity: 1, condition: 100, enchantment: null,
    identified: definition.identification.mode === 'known', charges: null,
    fuel: definition.light?.fuelCapacity ?? null, enabled: definition.light === null ? null : false,
    location: { type: 'floor', floorId: input.floorId, x: input.x, y: input.y } };
}

export function createRecordedHeirloom(input: Readonly<{
  content: CompiledContentPack;
  snapshot: RecordedHeirloomSnapshot;
  equippedItemContentIds: readonly OpaqueId[];
  fallbackItemId: OpaqueId;
  itemId: OpaqueId;
  floorId: OpaqueId;
  x: number;
  y: number;
}>): Readonly<{ item: ItemInstance; fallback: boolean; displayName: string; glyph: string; color: string }> {
  const resolvedContentId = recordedHeirloomContentId(input);
  const definition = itemDefinition(input.content, resolvedContentId);
  const fallback = resolvedContentId !== input.snapshot.contentId;
  const displayName = boundedDisplayText(fallback ? definition.name : input.snapshot.displayName);
  const item: ItemInstance = {
    itemId: input.itemId, contentId: definition.id, quantity: 1,
    condition: fallback ? 100 : input.snapshot.condition,
    enchantment: fallback ? null : input.snapshot.enchantment,
    identified: true,
    charges: fallback ? null : input.snapshot.charges,
    fuel: fallback ? definition.light?.fuelCapacity ?? null : input.snapshot.fuel,
    enabled: definition.light === null ? null : false,
    location: { type: 'floor', floorId: input.floorId, x: input.x, y: input.y },
    heirloom: { displayName,
      glyph: fallback ? definition.glyph : input.snapshot.glyph,
      color: fallback ? definition.color : input.snapshot.color,
      originatingHallRecordId: input.snapshot.originatingHallRecordId,
      originatingRank: 1, sourceItemId: input.snapshot.sourceItemId },
  };
  return { item, fallback,
    displayName,
    glyph: fallback ? definition.glyph : input.snapshot.glyph,
    color: fallback ? definition.color : input.snapshot.color };
}

export function recordedHeirloomContentId(input: Readonly<{
  content: CompiledContentPack;
  snapshot: RecordedHeirloomSnapshot;
  equippedItemContentIds: readonly OpaqueId[];
  fallbackItemId: OpaqueId;
}>): OpaqueId {
  const recorded = input.content.entries.find((entry): entry is ItemContentEntry =>
    entry.kind === 'item' && entry.id === input.snapshot.contentId);
  const fuelCompatible = recorded?.light === null
    ? input.snapshot.fuel === null
    : recorded?.light !== undefined && input.snapshot.fuel !== null
      && input.snapshot.fuel <= recorded.light.fuelCapacity;
  const modifiersCompatible = Object.keys(input.snapshot.enchantment?.modifiers ?? {})
    .every((name) => (DERIVED_STAT_NAMES as readonly string[]).includes(name));
  return input.snapshot.sourceItemId !== null
    && input.equippedItemContentIds.includes(input.snapshot.contentId)
    && recorded?.heirloomEligible === true && recorded.equipment !== null && fuelCompatible && modifiersCompatible
    ? input.snapshot.contentId : input.fallbackItemId;
}

export function canStack(left: ItemInstance, right: ItemInstance): boolean {
  return left.heirloom === undefined && right.heirloom === undefined
    && left.contentId === right.contentId
    && left.condition === right.condition
    && left.identified === right.identified
    && left.charges === right.charges
    && left.fuel === right.fuel
    && left.enabled === right.enabled
    && stableJson(left.enchantment) === stableJson(right.enchantment);
}

export function inventorySlotCount(input: Readonly<{
  run: Pick<ActiveRun, 'actors' | 'hero' | 'items'>;
  actorId: OpaqueId;
}>): Readonly<{ used: number; capacity: number }> {
  const actor = actorById(input.run, input.actorId);
  if (!actor) throw new Error(`internal invariant: actor ${input.actorId} does not exist`);
  const used = input.run.items.filter((item) => item.location.type === 'backpack'
    && item.location.actorId === actor.actorId).length;
  const capacity = actor.actorId === input.run.hero.actorId ? input.run.hero.backpackCapacity : 0;
  return { used, capacity };
}

export function pickupItem(input: Readonly<{
  run: ActiveRun;
  content: CompiledContentPack;
  actorId: OpaqueId;
  itemId: OpaqueId;
  quantity: number;
  newItemId?: OpaqueId;
}>): InventoryTransition {
  if (!positiveQuantity(input.quantity)) return failure('item.quantity');
  const actor = actorById(input.run, input.actorId);
  const source = input.run.items.find((item) => item.itemId === input.itemId);
  if (!actor || !source) return failure('item.missing');
  if (source.location.type !== 'floor' || source.location.floorId !== actor.floorId
    || source.location.x !== actor.x || source.location.y !== actor.y) return failure('item.unavailable');
  if (input.quantity > source.quantity) return failure('item.quantity');
  const definition = itemDefinition(input.content, source.contentId);
  const backpack = input.run.items.filter((item) => item.location.type === 'backpack'
    && item.location.actorId === actor.actorId && canStack(item, source))
    .sort((left, right) => left.itemId < right.itemId ? -1 : left.itemId > right.itemId ? 1 : 0);
  let remaining = input.quantity;
  const updates = new Map<OpaqueId, ItemInstance>();
  for (const target of backpack) {
    const transferred = Math.min(remaining, definition.stackLimit - target.quantity);
    if (transferred <= 0) continue;
    updates.set(target.itemId, { ...target, quantity: target.quantity + transferred });
    remaining -= transferred;
    if (remaining === 0) break;
  }
  const slots = inventorySlotCount({ run: input.run, actorId: actor.actorId });
  if (remaining > 0 && slots.used >= slots.capacity) return failure('inventory.full');
  const sourceRemainder = source.quantity - input.quantity;
  let carried: ItemInstance | undefined;
  if (remaining > 0) {
    const carriedId = sourceRemainder === 0 ? source.itemId : input.newItemId;
    if (!carriedId) return failure('item.unavailable');
    if (carriedId !== source.itemId && input.run.items.some((item) => item.itemId === carriedId)) return failure('item.id-conflict');
    carried = {
      ...source, itemId: carriedId, quantity: remaining,
      location: { type: 'backpack', actorId: actor.actorId },
    };
  }
  const items = input.run.items.flatMap((item) => {
    const update = updates.get(item.itemId);
    if (update) return [update];
    if (item.itemId !== source.itemId) return [item];
    if (sourceRemainder > 0) return [{ ...source, quantity: sourceRemainder }];
    return carried?.itemId === source.itemId ? [carried] : [];
  });
  if (carried && carried.itemId !== source.itemId) items.push(carried);
  return success(input.run, items);
}

export function dropItem(input: Readonly<{
  run: ActiveRun;
  actorId: OpaqueId;
  itemId: OpaqueId;
  quantity: number;
  newItemId?: OpaqueId;
}>): InventoryTransition {
  if (!positiveQuantity(input.quantity)) return failure('item.quantity');
  const actor = actorById(input.run, input.actorId);
  const source = input.run.items.find((item) => item.itemId === input.itemId);
  if (!actor || !source) return failure('item.missing');
  if (source.location.type !== 'backpack' || source.location.actorId !== actor.actorId) return failure('item.unavailable');
  if (input.quantity > source.quantity) return failure('item.quantity');
  const partial = input.quantity < source.quantity;
  const droppedId = partial ? input.newItemId : source.itemId;
  if (!droppedId) return failure('item.unavailable');
  if (partial && input.run.items.some((item) => item.itemId === droppedId)) return failure('item.id-conflict');
  const dropped: ItemInstance = {
    ...source, itemId: droppedId, quantity: input.quantity,
    location: { type: 'floor', floorId: actor.floorId, x: actor.x, y: actor.y },
  };
  const items = input.run.items.map((item) => item.itemId === source.itemId
    ? (partial ? { ...source, quantity: source.quantity - input.quantity } : dropped) : item);
  if (partial) items.push(dropped);
  return success(input.run, items);
}

export function splitStack(input: Readonly<{
  run: ActiveRun;
  content: CompiledContentPack;
  actorId: OpaqueId;
  itemId: OpaqueId;
  quantity: number;
  newItemId: OpaqueId;
}>): InventoryTransition {
  if (!positiveQuantity(input.quantity)) return failure('item.quantity');
  const source = input.run.items.find((item) => item.itemId === input.itemId);
  if (!source) return failure('item.missing');
  if (source.location.type !== 'backpack' || source.location.actorId !== input.actorId) return failure('item.unavailable');
  if (input.quantity >= source.quantity || input.quantity > itemDefinition(input.content, source.contentId).stackLimit) {
    return failure('item.quantity');
  }
  if (input.run.items.some((item) => item.itemId === input.newItemId)) return failure('item.id-conflict');
  const slots = inventorySlotCount({ run: input.run, actorId: input.actorId });
  if (slots.used >= slots.capacity) return failure('inventory.full');
  const split: ItemInstance = { ...source, itemId: input.newItemId, quantity: input.quantity };
  const items = input.run.items.map((item) => item.itemId === source.itemId
    ? { ...source, quantity: source.quantity - input.quantity } : item);
  items.push(split);
  return success(input.run, items);
}

export function mergeStacks(input: Readonly<{
  run: ActiveRun;
  content: CompiledContentPack;
  actorId: OpaqueId;
  leftItemId: OpaqueId;
  rightItemId: OpaqueId;
}>): InventoryTransition {
  const left = input.run.items.find((item) => item.itemId === input.leftItemId);
  const right = input.run.items.find((item) => item.itemId === input.rightItemId);
  if (!left || !right || left.itemId === right.itemId) return failure('item.missing');
  if (left.location.type !== 'backpack' || right.location.type !== 'backpack'
    || left.location.actorId !== input.actorId || right.location.actorId !== input.actorId) return failure('item.unavailable');
  if (!canStack(left, right)) return failure('item.incompatible');
  const [receiver, donor] = left.itemId < right.itemId ? [left, right] : [right, left];
  const limit = itemDefinition(input.content, receiver.contentId).stackLimit;
  const transferred = Math.min(donor.quantity, limit - receiver.quantity);
  if (transferred <= 0) return failure('item.incompatible');
  const items = input.run.items.flatMap((item) => {
    if (item.itemId === receiver.itemId) return [{ ...receiver, quantity: receiver.quantity + transferred }];
    if (item.itemId !== donor.itemId) return [item];
    return donor.quantity === transferred ? [] : [{ ...donor, quantity: donor.quantity - transferred }];
  });
  return success(input.run, items);
}

export function consumeItemQuantity(input: Readonly<{
  run: ActiveRun;
  itemId: OpaqueId;
  quantity: number;
}>): InventoryTransition {
  const result = consumeItemQuantityFromItems({
    items: input.run.items, itemId: input.itemId, quantity: input.quantity,
  });
  return result.ok ? success(input.run, result.items) : result;
}

export type ItemQuantityTransition =
  | Readonly<{ ok: true; items: readonly ItemInstance[] }>
  | Readonly<{ ok: false; reason: InventoryFailureReason }>;

export function consumeItemQuantityFromItems(input: Readonly<{
  items: readonly ItemInstance[];
  itemId: OpaqueId;
  quantity: number;
}>): ItemQuantityTransition {
  if (!positiveQuantity(input.quantity)) return failure('item.quantity');
  const source = input.items.find((item) => item.itemId === input.itemId);
  if (!source) return failure('item.missing');
  if (input.quantity > source.quantity) return failure('item.quantity');
  const items = input.items.flatMap((item) => item.itemId !== source.itemId ? [item]
    : item.quantity === input.quantity ? [] : [{ ...item, quantity: item.quantity - input.quantity }]);
  return { ok: true, items };
}
