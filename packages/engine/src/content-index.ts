import type {
  CompiledContentPack, ContentEntry, EncounterContentEntry, EncounterModel,
  ItemContentEntry,
} from '@woven-deep/content';
import type { OpaqueId } from './model.js';

const packIndexes = new WeakMap<CompiledContentPack, Map<string, ContentEntry>>();

function packIndex(content: CompiledContentPack): Map<string, ContentEntry> {
  let index = packIndexes.get(content);
  if (index === undefined) {
    index = new Map();
    for (const entry of content.entries) {
      if (!index.has(entry.id)) index.set(entry.id, entry);
    }
    packIndexes.set(content, index);
  }
  return index;
}

export function entryById(content: CompiledContentPack, id: OpaqueId): ContentEntry | undefined {
  return packIndex(content).get(id);
}

export function requireItem(content: CompiledContentPack, contentId: OpaqueId): ItemContentEntry {
  const entry = entryById(content, contentId);
  if (!entry || entry.kind !== 'item') {
    throw new Error(`internal invariant: item definition ${contentId} does not exist`);
  }
  return entry;
}

export function requireEncounter<M extends EncounterModel>(
  content: CompiledContentPack,
  encounterId: OpaqueId,
  model: M,
): Extract<EncounterContentEntry, { model: M }> {
  const entry = entryById(content, encounterId);
  if (!entry || entry.kind !== 'encounter' || entry.model !== model) {
    throw new Error(`internal invariant: ${model} encounter ${encounterId} does not exist`);
  }
  return entry as Extract<EncounterContentEntry, { model: M }>;
}
