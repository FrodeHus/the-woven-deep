import { DERIVED_STAT_NAMES, type CompiledContentPack, type ContentEntry, type ItemContentEntry } from '@woven-deep/content';
import type { ActiveRun } from './model.js';

function entryMap(pack: CompiledContentPack): ReadonlyMap<string, ContentEntry> {
  return new Map(pack.entries.map((entry) => [entry.id, entry]));
}

function itemDefinition(entries: ReadonlyMap<string, ContentEntry>, contentId: string): ItemContentEntry {
  const definition = entries.get(contentId);
  if (!definition || definition.kind !== 'item') {
    throw new Error(`content-bound validation: item ${contentId} definition does not exist`);
  }
  return definition;
}

export function validateContentBoundRun(run: ActiveRun, pack: CompiledContentPack): void {
  if (run.contentHash !== pack.hash) {
    throw new Error(`content-bound validation: content hash ${pack.hash} does not match run ${run.contentHash}`);
  }
  const entries = entryMap(pack);
  const balanceCount = pack.entries.filter((entry) => entry.kind === 'balance').length;
  if (balanceCount !== 1) throw new Error(`content-bound validation: expected one balance definition; found ${balanceCount}`);
  for (const item of run.items) {
    const definition = itemDefinition(entries, item.contentId);
    if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0 || item.quantity > definition.stackLimit) {
      throw new RangeError(`content-bound validation: item ${item.itemId} quantity exceeds stack limit ${definition.stackLimit}`);
    }
    if (item.location.type === 'equipped') {
      if (!definition.equipment || !definition.equipment.slots.includes(item.location.slot)) {
        throw new Error(`content-bound validation: item ${item.itemId} cannot use equipment slot ${item.location.slot}`);
      }
    }
    if (definition.light === null && (item.fuel !== null || item.enabled !== null)) {
      throw new Error(`content-bound validation: non-light item ${item.itemId} cannot store fuel or enabled state`);
    }
    if (definition.light !== null && (item.fuel === null || item.enabled === null
      || item.fuel > definition.light.fuelCapacity)) {
      throw new Error(`content-bound validation: light item ${item.itemId} has invalid fuel state`);
    }
    for (const name of Object.keys(item.enchantment?.modifiers ?? {})) {
      if (!(DERIVED_STAT_NAMES as readonly string[]).includes(name)) {
        throw new Error(`content-bound validation: item ${item.itemId} enchantment modifier ${name} is unknown`);
      }
    }
  }
  for (const entry of pack.entries) {
    if (entry.kind !== 'item' || !entry.equipment) continue;
    const equipment = entry.equipment;
    if (equipment.handedness === 'one-handed' && equipment.reservedSlots.length > 0) {
      throw new Error(`content-bound validation: item ${entry.id} one-handed handedness cannot reserve slots`);
    }
    if (equipment.handedness === 'two-handed'
      && (!equipment.slots.includes('main-hand') || !equipment.reservedSlots.includes('off-hand'))) {
      throw new Error(`content-bound validation: item ${entry.id} two-handed handedness requires main-hand and off-hand reserved slots`);
    }
    if (equipment.handedness === 'none'
      && (equipment.slots.some((slot) => slot === 'main-hand' || slot === 'off-hand')
        || equipment.reservedSlots.length > 0)) {
      throw new Error(`content-bound validation: item ${entry.id} non-handed equipment cannot use reserved slots`);
    }
  }
  for (const actor of run.actors) {
    const claimed = new Map<string, string>();
    for (const [slot, itemId] of Object.entries(actor.equipment)) {
      if (itemId === null) continue;
      const item = run.items.find((candidate) => candidate.itemId === itemId);
      if (!item) throw new Error(`content-bound validation: equipped item ${itemId} does not exist`);
      const equipment = itemDefinition(entries, item.contentId).equipment;
      if (!equipment) throw new Error(`content-bound validation: item ${itemId} is not equipment`);
      for (const occupied of [slot, ...equipment.reservedSlots]) {
        const existing = claimed.get(occupied);
        if (existing && existing !== item.itemId) {
          throw new Error(`content-bound validation: equipment items ${existing} and ${item.itemId} overlap slot ${occupied}`);
        }
        claimed.set(occupied, item.itemId);
      }
    }
    if (actor.playerControlled || actor.behaviorId === null) continue;
    const definition = entries.get(actor.contentId);
    if (!definition || definition.kind !== 'monster') {
      throw new Error(`content-bound validation: actor ${actor.actorId} template ${actor.contentId} does not exist`);
    }
  }
  for (const actor of run.actors) {
    for (const condition of actor.conditions) {
      if (entries.get(condition.conditionId)?.kind !== 'condition') {
        throw new Error(`content-bound validation: condition ${condition.conditionId} definition does not exist`);
      }
    }
  }
  for (const feature of run.features) {
    if (feature.contentId === null || feature.type !== 'trap') continue;
    if (entries.get(feature.contentId)?.kind !== 'trap') {
      throw new Error(`content-bound validation: trap ${feature.featureId} definition ${feature.contentId} does not exist`);
    }
  }
}
