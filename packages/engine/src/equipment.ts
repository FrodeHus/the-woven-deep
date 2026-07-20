import type { CompiledContentPack, DerivedStatName, ItemContentEntry } from '@woven-deep/content';
import { actorById, type EquipmentSlot } from './actor-model.js';
import type { DerivedStatModifier } from './attributes.js';
import type { ItemInstance } from './item-model.js';
import type { LightSource } from './light-model.js';
import type { ActiveRun, OpaqueId } from './model.js';
import { consumeItemQuantity, inventorySlotCount } from './inventory.js';

const SLOT_ORDER: readonly EquipmentSlot[] = [
  'main-hand',
  'off-hand',
  'body',
  'head',
  'hands',
  'feet',
  'neck',
  'left-ring',
  'right-ring',
];

function itemDefinition(content: CompiledContentPack, contentId: OpaqueId): ItemContentEntry {
  const entry = content.entries.find((candidate) => candidate.id === contentId);
  if (!entry || entry.kind !== 'item')
    throw new Error(`internal invariant: item definition ${contentId} does not exist`);
  return entry;
}

export type EquipmentPlan =
  | Readonly<{
      ok: true;
      equip: readonly Readonly<{ itemId: OpaqueId; slot: EquipmentSlot }>[];
      unequip: readonly OpaqueId[];
      reservedSlots: readonly EquipmentSlot[];
    }>
  | Readonly<{ ok: false; reason: 'item.missing' | 'item.unavailable' | 'inventory.full' }>;

function orderedSlots(slots: ReadonlySet<EquipmentSlot>): readonly EquipmentSlot[] {
  return SLOT_ORDER.filter((slot) => slots.has(slot));
}

export function equipmentPlan(
  input: Readonly<{
    run: ActiveRun;
    content: CompiledContentPack;
    actorId: OpaqueId;
    itemId: OpaqueId;
    slot: EquipmentSlot;
  }>,
): EquipmentPlan {
  const actor = actorById(input.run, input.actorId);
  const source = input.run.items.find((item) => item.itemId === input.itemId);
  if (!actor || !source) return { ok: false, reason: 'item.missing' };
  if (
    (source.location.type !== 'backpack' && source.location.type !== 'equipped') ||
    source.location.actorId !== actor.actorId
  )
    return { ok: false, reason: 'item.unavailable' };
  const definition = itemDefinition(input.content, source.contentId);
  if (!definition.equipment?.slots.includes(input.slot))
    return { ok: false, reason: 'item.unavailable' };
  const occupied = new Set<EquipmentSlot>([input.slot, ...definition.equipment.reservedSlots]);
  const displaced: OpaqueId[] = [];
  for (const item of input.run.items) {
    if (
      item.itemId === source.itemId ||
      item.location.type !== 'equipped' ||
      item.location.actorId !== actor.actorId
    )
      continue;
    const existing = itemDefinition(input.content, item.contentId).equipment;
    const existingOccupied = new Set<EquipmentSlot>([
      item.location.slot,
      ...(existing?.reservedSlots ?? []),
    ]);
    if ([...occupied].some((slot) => existingOccupied.has(slot))) displaced.push(item.itemId);
  }
  displaced.sort();
  const slots = inventorySlotCount({ run: input.run, actorId: actor.actorId });
  const sourceLeavesBackpack = source.location.type === 'backpack' ? 1 : 0;
  if (slots.used - sourceLeavesBackpack + displaced.length > slots.capacity) {
    return { ok: false, reason: 'inventory.full' };
  }
  return {
    ok: true,
    equip: [{ itemId: source.itemId, slot: input.slot }],
    unequip: displaced,
    reservedSlots: orderedSlots(occupied),
  };
}

export type EquipmentTransition =
  | Readonly<{ ok: true; run: ActiveRun }>
  | Readonly<{ ok: false; reason: 'item.missing' | 'item.unavailable' | 'inventory.full' }>;

export function equipItem(
  input: Readonly<{
    run: ActiveRun;
    content: CompiledContentPack;
    actorId: OpaqueId;
    itemId: OpaqueId;
    slot: EquipmentSlot;
  }>,
): EquipmentTransition {
  const plan = equipmentPlan(input);
  if (!plan.ok) return plan;
  const actor = actorById(input.run, input.actorId)!;
  const source = input.run.items.find((item) => item.itemId === input.itemId)!;
  const displaced = new Set(plan.unequip);
  const equipment = { ...actor.equipment };
  if (source.location.type === 'equipped') equipment[source.location.slot] = null;
  for (const item of input.run.items) {
    if (displaced.has(item.itemId) && item.location.type === 'equipped')
      equipment[item.location.slot] = null;
  }
  equipment[input.slot] = source.itemId;
  const items = input.run.items.map((item): ItemInstance => {
    if (item.itemId === source.itemId)
      return { ...item, location: { type: 'equipped', actorId: actor.actorId, slot: input.slot } };
    if (displaced.has(item.itemId))
      return { ...item, location: { type: 'backpack', actorId: actor.actorId } };
    return item;
  });
  return {
    ok: true,
    run: {
      ...input.run,
      items,
      actors: input.run.actors.map((candidate) =>
        candidate.actorId === actor.actorId ? { ...actor, equipment } : candidate,
      ),
    },
  };
}

export function unequipItem(
  input: Readonly<{
    run: ActiveRun;
    actorId: OpaqueId;
    slot: EquipmentSlot;
  }>,
): EquipmentTransition {
  const actor = actorById(input.run, input.actorId);
  if (!actor) return { ok: false, reason: 'item.missing' };
  const itemId = actor.equipment[input.slot];
  if (!itemId) return { ok: false, reason: 'item.unavailable' };
  const slots = inventorySlotCount({ run: input.run, actorId: actor.actorId });
  if (slots.used >= slots.capacity) return { ok: false, reason: 'inventory.full' };
  const equipment = { ...actor.equipment, [input.slot]: null };
  return {
    ok: true,
    run: {
      ...input.run,
      actors: input.run.actors.map((candidate) =>
        candidate.actorId === actor.actorId ? { ...actor, equipment } : candidate,
      ),
      items: input.run.items.map((item) =>
        item.itemId === itemId
          ? { ...item, location: { type: 'backpack' as const, actorId: actor.actorId } }
          : item,
      ),
    },
  };
}

export interface EquipmentModifierSource {
  readonly itemId: OpaqueId;
  readonly modifiers: DerivedStatModifier;
  readonly publicModifiers: DerivedStatModifier;
}

export function equipmentModifiers(
  input: Readonly<{
    run: Pick<ActiveRun, 'actors' | 'items'>;
    content: CompiledContentPack;
    actorId: OpaqueId;
  }>,
): readonly EquipmentModifierSource[] {
  const actor = actorById(input.run, input.actorId);
  if (!actor) throw new Error(`internal invariant: actor ${input.actorId} does not exist`);
  const sources: EquipmentModifierSource[] = [];
  for (const slot of SLOT_ORDER) {
    const itemId = actor.equipment[slot];
    if (!itemId || sources.some((source) => source.itemId === itemId)) continue;
    const item = input.run.items.find((candidate) => candidate.itemId === itemId);
    if (!item) throw new Error(`internal invariant: equipped item ${itemId} does not exist`);
    const definition = itemDefinition(input.content, item.contentId);
    const base: Partial<Record<DerivedStatName, number>> = {};
    if (definition.combat?.defense) base.defense = definition.combat.defense;
    if (definition.combat?.accuracy) {
      base[definition.combat.ammunitionTag ? 'rangedAccuracy' : 'meleeAccuracy'] =
        definition.combat.accuracy;
    }
    const modifiers = { ...base } as Record<string, number>;
    for (const [name, amount] of Object.entries(item.enchantment?.modifiers ?? {})) {
      modifiers[name] = (modifiers[name] ?? 0) + amount;
    }
    sources.push({ itemId, modifiers, publicModifiers: item.identified ? modifiers : base });
  }
  return sources;
}

export function itemLightSources(
  input: Readonly<{
    run: Pick<ActiveRun, 'actors' | 'items'>;
    content: CompiledContentPack;
    floorId: OpaqueId;
  }>,
): readonly LightSource[] {
  const lights: LightSource[] = [];
  for (const item of input.run.items) {
    const definition = itemDefinition(input.content, item.contentId);
    if (!definition.light || item.enabled !== true || (item.fuel ?? 0) <= 0) continue;
    let location: LightSource['location'];
    if (item.location.type === 'floor') {
      if (item.location.floorId !== input.floorId) continue;
      location = { type: 'fixed', x: item.location.x, y: item.location.y };
    } else if (item.location.type === 'equipped') {
      const actor = actorById(input.run, item.location.actorId);
      // A dead wielder stays in `run.actors` but is filtered out of every turn-preparation
      // position map (which only tracks `health > 0` actors). Without this check, a dead
      // actor's still-enabled light would emit a source the lighting resolver can never
      // locate, throwing a RangeError deep inside illumination. Skip it at the source so no
      // caller of itemLightSources needs to know about this asymmetry.
      if (!actor || actor.floorId !== input.floorId || actor.health <= 0) continue;
      location = { type: 'actor', actorId: actor.actorId };
    } else continue;
    lights.push({
      lightId: item.itemId,
      location,
      color: definition.light.color,
      radius: definition.light.radius,
      strength: definition.light.strength,
      enabled: true,
      falloff: 'linear',
      vaultPlacementId: null,
      presentation: null,
    });
  }
  return lights.sort((left, right) =>
    left.lightId < right.lightId ? -1 : left.lightId > right.lightId ? 1 : 0,
  );
}

function ownedBy(item: ItemInstance, actorId: OpaqueId): boolean {
  return (
    (item.location.type === 'backpack' || item.location.type === 'equipped') &&
    item.location.actorId === actorId
  );
}

export function toggleItemLight(
  input: Readonly<{
    run: ActiveRun;
    content: CompiledContentPack;
    actorId: OpaqueId;
    itemId: OpaqueId;
    enabled: boolean;
  }>,
): EquipmentTransition {
  const item = input.run.items.find((candidate) => candidate.itemId === input.itemId);
  if (!item) return { ok: false, reason: 'item.missing' };
  if (!ownedBy(item, input.actorId) || !itemDefinition(input.content, item.contentId).light) {
    return { ok: false, reason: 'item.unavailable' };
  }
  if (input.enabled && (item.fuel ?? 0) <= 0) return { ok: false, reason: 'item.unavailable' };
  return {
    ok: true,
    run: {
      ...input.run,
      items: input.run.items.map((candidate) =>
        candidate.itemId === item.itemId ? { ...candidate, enabled: input.enabled } : candidate,
      ),
    },
  };
}

export type RefuelTransition = EquipmentTransition & Readonly<{ quantity?: number }>;

export function refuelItem(
  input: Readonly<{
    run: ActiveRun;
    content: CompiledContentPack;
    actorId: OpaqueId;
    itemId: OpaqueId;
    fuelItemId: OpaqueId;
    quantity: number;
  }>,
): RefuelTransition {
  const target = input.run.items.find((item) => item.itemId === input.itemId);
  const fuel = input.run.items.find((item) => item.itemId === input.fuelItemId);
  if (!target || !fuel) return { ok: false, reason: 'item.missing' };
  const light = itemDefinition(input.content, target.contentId).light;
  const fuelDefinition = itemDefinition(input.content, fuel.contentId);
  if (
    !light ||
    !ownedBy(target, input.actorId) ||
    fuel.location.type !== 'backpack' ||
    fuel.location.actorId !== input.actorId ||
    !fuelDefinition.tags.some((tag) => light.fuelTags.includes(tag))
  ) {
    return { ok: false, reason: 'item.unavailable' };
  }
  if (
    !Number.isSafeInteger(input.quantity) ||
    input.quantity <= 0 ||
    input.quantity > fuel.quantity
  ) {
    return { ok: false, reason: 'item.unavailable' };
  }
  const quantity = Math.min(input.quantity, light.fuelCapacity - (target.fuel ?? 0));
  if (quantity <= 0) return { ok: false, reason: 'item.unavailable' };
  const consumed = consumeItemQuantity({ run: input.run, itemId: fuel.itemId, quantity });
  if (!consumed.ok)
    return {
      ok: false,
      reason: consumed.reason === 'item.missing' ? 'item.missing' : 'item.unavailable',
    };
  return {
    ok: true,
    quantity,
    run: {
      ...consumed.run,
      items: consumed.run.items.map((item) =>
        item.itemId === target.itemId ? { ...item, fuel: (target.fuel ?? 0) + quantity } : item,
      ),
    },
  };
}
