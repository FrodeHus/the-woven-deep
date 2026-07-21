import type {
  BackgroundContentEntry,
  BalanceContentEntry,
  ClassContentEntry,
  CompiledContentPack,
  ContentEntry,
  ContentKind,
  ItemContentEntry,
  MonsterContentEntry,
  SpellContentEntry,
  TraitContentEntry,
} from '@woven-deep/content';

/**
 * The single typed boundary over a `CompiledContentPack`'s flat `entries` list. The compiled pack
 * mixes every content kind into one `readonly ContentEntry[]`; consumers reach a specific kind
 * through the two generic cores here (`entriesByKind`/`entryById`) and the per-kind helpers built on
 * them, rather than re-narrowing the union with their own `entry is XEntry` predicate. Each helper
 * preserves the pack's own entry order and returns the exact same entry a hand-written
 * `entries.find`/`entries.filter` kind guard would.
 */

type EntryOfKind<K extends ContentKind> = Extract<ContentEntry, { readonly kind: K }>;

/** Every entry of the given kind, in the pack's own entry order. */
export function entriesByKind<K extends ContentKind>(
  pack: CompiledContentPack,
  kind: K,
): readonly EntryOfKind<K>[] {
  return pack.entries.filter((entry): entry is EntryOfKind<K> => entry.kind === kind);
}

/** The first entry of the given kind whose id matches, or `undefined`. */
export function entryById<K extends ContentKind>(
  pack: CompiledContentPack,
  kind: K,
  id: string,
): EntryOfKind<K> | undefined {
  return pack.entries.find(
    (entry): entry is EntryOfKind<K> => entry.kind === kind && entry.id === id,
  );
}

/** The pack's balance entry (the first one), or `undefined`. */
export function balanceEntry(pack: CompiledContentPack): BalanceContentEntry | undefined {
  return pack.entries.find((entry): entry is BalanceContentEntry => entry.kind === 'balance');
}

export function classById(pack: CompiledContentPack, id: string): ClassContentEntry | undefined {
  return entryById(pack, 'class', id);
}

export function classEntries(pack: CompiledContentPack): readonly ClassContentEntry[] {
  return entriesByKind(pack, 'class');
}

export function backgroundById(
  pack: CompiledContentPack,
  id: string,
): BackgroundContentEntry | undefined {
  return entryById(pack, 'background', id);
}

export function backgroundEntries(pack: CompiledContentPack): readonly BackgroundContentEntry[] {
  return entriesByKind(pack, 'background');
}

export function traitById(pack: CompiledContentPack, id: string): TraitContentEntry | undefined {
  return entryById(pack, 'trait', id);
}

export function traitEntries(pack: CompiledContentPack): readonly TraitContentEntry[] {
  return entriesByKind(pack, 'trait');
}

export function itemById(pack: CompiledContentPack, id: string): ItemContentEntry | undefined {
  return entryById(pack, 'item', id);
}

export function itemEntries(pack: CompiledContentPack): readonly ItemContentEntry[] {
  return entriesByKind(pack, 'item');
}

export function monsterEntries(pack: CompiledContentPack): readonly MonsterContentEntry[] {
  return entriesByKind(pack, 'monster');
}

export function monsterById(
  pack: CompiledContentPack,
  id: string,
): MonsterContentEntry | undefined {
  return entryById(pack, 'monster', id);
}

export function spellEntries(pack: CompiledContentPack): readonly SpellContentEntry[] {
  return entriesByKind(pack, 'spell');
}
