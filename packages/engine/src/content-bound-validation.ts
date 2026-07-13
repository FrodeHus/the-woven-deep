import type { CompiledContentPack, ContentEntry, ItemContentEntry } from '@woven-deep/content';
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
  }
  for (const actor of run.actors) {
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
