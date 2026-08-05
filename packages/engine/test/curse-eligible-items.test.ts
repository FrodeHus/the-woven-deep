import { beforeAll, describe, expect, it } from 'vitest';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import { resolve } from 'node:path';
import type { CompiledContentPack, ItemContentEntry } from '@woven-deep/content';

let pack: CompiledContentPack;

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

/**
 * Curses may only ever land on base equipment: `weapon`, `armor`, `shield`, `ring`, or `light`
 * items with no `artifact` block (artifacts stay `mode: known` and are excluded regardless of
 * category). Later tasks (curse assignment on identification) depend on this set being non-empty
 * for every eligible category -- an empty category here means curses can never roll for it.
 */
const CURSE_ELIGIBLE_CATEGORIES = ['weapon', 'armor', 'shield', 'ring', 'light'] as const;

function eligibleCurseItems(content: CompiledContentPack): readonly ItemContentEntry[] {
  return content.entries.filter(
    (entry): entry is ItemContentEntry =>
      entry.kind === 'item' &&
      (CURSE_ELIGIBLE_CATEGORIES as readonly string[]).includes(entry.category) &&
      entry.artifact === null,
  );
}

describe('curse-eligible items', () => {
  it('resolves a non-empty eligible-category item list from the bundled content pack', () => {
    const eligible = eligibleCurseItems(pack);
    expect(eligible.length).toBeGreaterThan(0);
  });

  it('has at least one eligible, non-artifact item per curse-eligible category', () => {
    const eligible = eligibleCurseItems(pack);
    for (const category of CURSE_ELIGIBLE_CATEGORIES) {
      const inCategory = eligible.filter((item) => item.category === category);
      expect(inCategory.length, `expected at least one eligible ${category} item`).toBeGreaterThan(
        0,
      );
    }
  });

  it('excludes artifact-bearing items from the eligible set even when their category matches', () => {
    const eligible = eligibleCurseItems(pack);
    const artifactItems = pack.entries.filter(
      (entry): entry is ItemContentEntry =>
        entry.kind === 'item' &&
        (CURSE_ELIGIBLE_CATEGORIES as readonly string[]).includes(entry.category) &&
        entry.artifact !== null,
    );
    expect(artifactItems.length).toBeGreaterThan(0);
    for (const artifactItem of artifactItems) {
      expect(eligible.some((item) => item.id === artifactItem.id)).toBe(false);
    }
  });

  /** Spec amendment (2026-08-05, cursed-items design): items whose identity is visually
   * unmistakable stay `mode: known` even in an eligible category -- a pitch torch is a stick with
   * a burning cloth. They remain curse-eligible (eligibility keys on category); only the
   * unidentified-appearance gamble is waived. */
  const VISUALLY_UNMISTAKABLE = new Set(['item.pitch-torch']);

  it('every eligible item declares mode: instance with an identification pool, unless visually unmistakable', () => {
    const eligible = eligibleCurseItems(pack);
    for (const item of eligible) {
      if (VISUALLY_UNMISTAKABLE.has(item.id)) {
        expect(item.identification.mode, `${item.id} should be mode: known`).toBe('known');
        continue;
      }
      expect(item.identification.mode, `${item.id} should be mode: instance`).toBe('instance');
      expect(item.identification.poolId, `${item.id} should declare a pool`).not.toBeNull();
    }
  });
});
