import { DERIVED_STAT_NAMES, type CompiledContentPack, type ContentEntry, type IdentificationPoolContentEntry, type ItemContentEntry } from '@woven-deep/content';
import type { ActiveRun } from './model.js';
import { unidentifiedPresentation } from './identification.js';
import { hungerStage } from './survival.js';

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
  const unidentifiedItems = pack.entries.filter((entry): entry is ItemContentEntry =>
    entry.kind === 'item' && entry.identification.mode !== 'known');
  const mappedContentIds = Object.keys(run.identification.appearanceByContentId).sort();
  const expectedContentIds = unidentifiedItems.map((entry) => entry.id).sort();
  if (mappedContentIds.length !== expectedContentIds.length
    || mappedContentIds.some((contentId, index) => contentId !== expectedContentIds[index])) {
    throw new Error('content-bound validation: identification map does not match unidentified item definitions');
  }
  const assignedAppearances = new Set<string>();
  for (const item of unidentifiedItems) {
    const appearanceId = run.identification.appearanceByContentId[item.id];
    const pool = pack.entries.find((entry): entry is IdentificationPoolContentEntry =>
      entry.kind === 'identification-pool' && entry.id === item.identification.poolId);
    if (!appearanceId || !pool) {
      throw new Error(`content-bound validation: identification map appearance for ${item.id} is invalid`);
    }
    try { unidentifiedPresentation({ content: pack, appearanceId }); } catch {
      throw new Error(`content-bound validation: identification map appearance for ${item.id} is invalid`);
    }
    const groupKey = `${pool.id}:${appearanceId}`;
    if (assignedAppearances.has(groupKey)) {
      throw new Error(`content-bound validation: identification map for ${pool.id} does not use unique names`);
    }
    assignedAppearances.add(groupKey);
  }
  const allocatedAppearances = new Set(unidentifiedItems
    .filter((item) => item.identification.mode === 'shuffled')
    .map((item) => run.identification.appearanceByContentId[item.id]!));
  for (const appearanceId of run.identification.knownAppearanceIds) {
    if (!allocatedAppearances.has(appearanceId)) {
      throw new Error(`content-bound validation: known appearance ${appearanceId} was not allocated`);
    }
  }
  const balances = pack.entries.filter((entry) => entry.kind === 'balance');
  if (balances.length !== 1) throw new Error(`content-bound validation: expected one balance definition; found ${balances.length}`);
  const balance = balances[0]!;
  if (run.survival.hungerReserve > balance.hungerMaximum) {
    throw new Error(`content-bound validation: hunger reserve exceeds maximum ${balance.hungerMaximum}`);
  }
  const expectedStage = hungerStage({ reserve: run.survival.hungerReserve, thresholds: balance.hungerThresholds });
  if (run.survival.hungerStage !== expectedStage) {
    throw new Error(`content-bound validation: hunger stage ${run.survival.hungerStage} does not match ${expectedStage}`);
  }
  if ((expectedStage === 'starving') !== (run.survival.nextStarvationAt !== null)) {
    throw new Error('content-bound validation: starvation deadline must exist exactly while starving');
  }
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
