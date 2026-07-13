import type { CompiledContentPack, ItemContentEntry } from '@woven-deep/content';
import type { IdentificationState } from './item-model.js';
import type { ActiveRun, DomainEvent, OpaqueId, RngStreams } from './model.js';
import { rollDie } from './random.js';

export function allocateIdentificationMap(input: Readonly<{
  content: CompiledContentPack;
  rng: RngStreams;
}>): Readonly<{ identification: IdentificationState; rng: RngStreams }> {
  const groups = new Map<string, ItemContentEntry[]>();
  for (const entry of input.content.entries) {
    if (entry.kind !== 'item' || entry.identification.mode !== 'shuffled' || !entry.identification.groupId) continue;
    const values = groups.get(entry.identification.groupId) ?? [];
    values.push(entry);
    groups.set(entry.identification.groupId, values);
  }
  let cursor = input.rng.effects;
  const pairs: Array<readonly [string, string]> = [];
  for (const groupId of [...groups.keys()].sort()) {
    const items = groups.get(groupId)!.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
    const appearances = [...new Set(items.flatMap((item) => item.identification.appearances))].sort();
    if (appearances.length !== items.length) {
      throw new Error(`identification group ${groupId} requires one appearance per item`);
    }
    for (let index = appearances.length - 1; index > 0; index -= 1) {
      const rolled = rollDie(cursor, index + 1); cursor = rolled.state;
      const swap = rolled.value - 1;
      [appearances[index], appearances[swap]] = [appearances[swap]!, appearances[index]!];
    }
    items.forEach((item, index) => pairs.push([item.id, appearances[index]!]));
  }
  pairs.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  return {
    identification: { appearanceByContentId: Object.fromEntries(pairs), knownAppearanceIds: [] },
    rng: { ...input.rng, effects: cursor },
  };
}

export function identifyAppearance(input: Readonly<{
  run: ActiveRun; contentId: OpaqueId; eventId: OpaqueId;
}>): Readonly<{ state: ActiveRun; events: readonly DomainEvent[] }> {
  const appearanceId = input.run.identification.appearanceByContentId[input.contentId];
  if (!appearanceId || input.run.identification.knownAppearanceIds.includes(appearanceId)) {
    return { state: input.run, events: [] };
  }
  const knownAppearanceIds = [...input.run.identification.knownAppearanceIds, appearanceId].sort();
  return { state: { ...input.run, identification: { ...input.run.identification, knownAppearanceIds } },
    events: [{ type: 'identification.appearance-revealed', eventId: input.eventId, appearanceId, contentId: input.contentId }] };
}

export function identifyItem(input: Readonly<{
  run: ActiveRun; itemId: OpaqueId; eventId: OpaqueId;
}>): Readonly<{ state: ActiveRun; events: readonly DomainEvent[] }> {
  const item = input.run.items.find((candidate) => candidate.itemId === input.itemId);
  if (!item) throw new Error(`internal invariant: item ${input.itemId} does not exist`);
  if (item.identified) return { state: input.run, events: [] };
  return { state: { ...input.run, items: input.run.items.map((candidate) => candidate.itemId === item.itemId
    ? { ...candidate, identified: true } : candidate) },
    events: [{ type: 'item.identified', eventId: input.eventId, itemId: item.itemId }] };
}

export function projectItem(input: Readonly<{
  run: Pick<ActiveRun, 'items' | 'identification'>;
  content: CompiledContentPack;
  itemId: OpaqueId;
}>): Readonly<Record<string, unknown>> {
  const item = input.run.items.find((candidate) => candidate.itemId === input.itemId);
  if (!item) throw new Error(`internal invariant: item ${input.itemId} does not exist`);
  const entry = input.content.entries.find((candidate) => candidate.id === item.contentId);
  if (!entry || entry.kind !== 'item') throw new Error(`internal invariant: item definition ${item.contentId} does not exist`);
  const appearanceId = input.run.identification.appearanceByContentId[item.contentId];
  const appearanceKnown = appearanceId && input.run.identification.knownAppearanceIds.includes(appearanceId);
  if (entry.identification.mode === 'shuffled' && !appearanceKnown) {
    return { itemId: item.itemId, appearanceId, category: entry.category, quantity: item.quantity, identified: false };
  }
  const projected: Record<string, unknown> = {
    itemId: item.itemId, contentId: entry.id, name: entry.name, category: entry.category,
    quantity: item.quantity, identified: item.identified, effects: entry.effects,
  };
  if (item.enchantment && item.identified) projected.enchantment = item.enchantment;
  else if (item.enchantment || (entry.identification.mode === 'instance' && !item.identified)) {
    projected.unknownProperties = true;
  }
  return projected;
}
