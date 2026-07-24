import { describe, expect, it } from 'vitest';
import type { VaultContentEntry } from '@woven-deep/content';
import { milestoneBossVaultId } from '../src/index.js';

function vault(id: string, tags: string[], minDepth: number, maxDepth: number): VaultContentEntry {
  return {
    kind: 'vault',
    id,
    name: id,
    tags,
    minDepth,
    maxDepth,
    rarity: 'common',
    weight: 1,
    maxPerFloor: 1,
    margin: 0,
    transforms: { rotations: [0], reflectHorizontal: false },
    layout: ['#'],
    legend: { '#': { terrain: 'wall' } },
  } as unknown as VaultContentEntry;
}

describe('milestoneBossVaultId', () => {
  const vaults = [
    vault('vault.ashfather-arena', ['milestone-boss', 'milestone-boss-5'], 5, 5),
    vault('vault.tide-sovereign-arena', ['milestone-boss', 'milestone-boss-10'], 10, 10),
    vault('vault.lampwright-cache', [], 1, 20),
  ];

  it('returns the pinned arena id at a milestone depth', () => {
    expect(milestoneBossVaultId(vaults, 5)).toBe('vault.ashfather-arena');
    expect(milestoneBossVaultId(vaults, 10)).toBe('vault.tide-sovereign-arena');
  });

  it('returns undefined at a non-milestone depth', () => {
    expect(milestoneBossVaultId(vaults, 6)).toBeUndefined();
    expect(milestoneBossVaultId(vaults, 20)).toBeUndefined();
  });

  it('throws when two milestone-boss vaults are pinned to one depth', () => {
    const clashing = [...vaults, vault('vault.duplicate-arena', ['milestone-boss'], 5, 5)];
    expect(() => milestoneBossVaultId(clashing, 5)).toThrow(/depth 5/);
  });
});
