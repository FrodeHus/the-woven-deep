import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENT_CRITERIA_IDS,
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

    expect(pack.schemaVersion).toBe(6);
    expect(CONTENT_SCHEMA_VERSION).toBe(6);
    expect(pack.hash).toHaveLength(64);
  });

  it('exposes every schema-v6 content kind', () => {
    const kinds: ContentKind[] = [...CONTENT_KIND_IDS];

    expect(kinds).toHaveLength(17);
    expect(kinds).toEqual(expect.arrayContaining(['npc', 'npc-faction']));
    expect(kinds).toContain('condition');
    expect(kinds).toContain('identification-pool');
    expect(kinds).toContain('encounter');
    expect(kinds).toContain('fallen-champion-template');
    expect(kinds).toContain('achievement');
    expect(CONTENT_KIND_IDS).toEqual(expect.arrayContaining(['class', 'background', 'trait']));
  });

  it('publishes the closed achievement criteria registry', () => {
    expect(ACHIEVEMENT_CRITERIA_IDS).toEqual(['first-champion-defeat', 'first-echo-defeat']);
  });

  it('rejects a stored schema-v5 pack before exposing entries', async () => {
    const content = await import('../src/index.js');

    expect(() => content.validateCompiledContentPack({
      schemaVersion: 5,
      hash: '0'.repeat(64),
      entries: [],
      generationReport: { foundationalCategories: [] },
    })).toThrow(/Unsupported content schema version 5; expected 6/);
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
      schemaVersion: 6,
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
