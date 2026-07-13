import type { CompiledContentPack, ItemContentEntry } from '@woven-deep/content';
import { actorById } from './actor-model.js';
import type { ItemInstance } from './item-model.js';
import type { ActiveRun, OpaqueId } from './model.js';
import { stableJson } from './stable-json.js';

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

export function canStack(left: ItemInstance, right: ItemInstance): boolean {
  return left.contentId === right.contentId
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
