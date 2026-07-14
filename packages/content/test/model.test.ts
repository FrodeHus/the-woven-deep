import { describe, expect, it } from 'vitest';
import {
  CONTENT_SCHEMA_VERSION,
  CONTENT_KIND_IDS,
  type ContentKind,
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
      generationReport: { foundationalCategories: [] },
    };

    expect(pack.schemaVersion).toBe(3);
    expect(pack.hash).toHaveLength(64);
  });

  it('exposes every schema-v3 content kind', () => {
    const kinds: ContentKind[] = [...CONTENT_KIND_IDS];

    expect(kinds).toHaveLength(11);
    expect(kinds).toContain('condition');
    expect(kinds).toContain('identification-pool');
    expect(kinds).toContain('encounter');
    expect(kinds).toContain('fallen-champion-template');
  });

  it('rejects a stored schema-v1 pack before exposing entries', async () => {
    const content = await import('../src/index.js');

    expect(() => (content as any).validateCompiledContentPack({
      schemaVersion: 1,
      hash: '0'.repeat(64),
      entries: [],
    })).toThrow(/unsupported content schema version 1/i);
  });

  it('does not fill source defaults while validating a stored pack', async () => {
    const { validateCompiledContentPack } = await import('../src/index.js');
    expect(() => validateCompiledContentPack({
      schemaVersion: 3,
      hash: '0'.repeat(64),
      entries: [{
        kind: 'spell', id: 'spell.bad', name: 'Bad', tags: [], targetingId: 'target.self', range: 0,
        actionCost: 100, effects: [{ effectId: 'effect.heal', parameters: { dice: { count: 1, sides: 4, bonus: 0 } } }],
      }],
      generationReport: { foundationalCategories: [] },
    })).toThrow(/missing materialized fields/i);
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
