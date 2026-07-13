import { describe, expect, it } from 'vitest';
import {
  CONTENT_SCHEMA_VERSION,
  type CompiledContentPack,
  type ContentEntry,
  type VaultContentEntry,
} from '../src/index.js';

describe('content model', () => {
  it('publishes a versioned, immutable pack contract', () => {
    const pack: CompiledContentPack = {
      schemaVersion: CONTENT_SCHEMA_VERSION,
      hash: 'a'.repeat(64),
      entries: [],
    };

    expect(pack.schemaVersion).toBe(1);
    expect(pack.hash).toHaveLength(64);
  });

  it('publishes vault entries without presentation fields shared by actors and items', () => {
    const vault: VaultContentEntry = {
      kind: 'vault',
      id: 'vault.test-room',
      name: 'Test room',
      tags: ['test'],
      minDepth: 1,
      maxDepth: 5,
      rarity: 'common',
      weight: 10,
      maxPerFloor: 1,
      margin: 1,
      transforms: { rotations: [0, 180], reflectHorizontal: true },
      layout: ['#+'],
      legend: {
        '#': { terrain: 'wall', entrance: false, light: null, slot: null },
        '+': { terrain: 'floor', entrance: true, light: null, slot: null },
      },
      entranceCount: 1,
      requiredSlotIds: [],
    };
    const entry: ContentEntry = vault;

    expect(entry.kind).toBe('vault');
    expect('glyph' in entry).toBe(false);
    expect('color' in entry).toBe(false);
  });
});
