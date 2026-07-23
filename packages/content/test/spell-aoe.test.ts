import { describe, expect, it } from 'vitest';
import { contentFileSchema } from '../src/compiler/schema.js';

function spellFile(aoe: unknown) {
  return {
    schemaVersion: 7,
    entries: [
      {
        kind: 'spell',
        id: 'spell.test-burst',
        name: 'Test burst',
        tags: ['fire'],
        targetingId: 'target.burst',
        range: 6,
        actionCost: 100,
        weaveCost: 3,
        aoe,
        effects: [
          {
            effectId: 'effect.damage',
            parameters: { damageType: 'fire', dice: { count: 1, sides: 6, bonus: 0 } },
            requiresLivingTarget: true,
          },
        ],
      },
    ],
  };
}

describe('spell AoE schema', () => {
  it('accepts a burst descriptor with a positive integer radius', () => {
    const parsed = contentFileSchema.parse(spellFile({ shape: 'burst', radius: 2 }));
    const entry = parsed.entries[0]!;
    expect(entry.kind).toBe('spell');
    expect(entry).toMatchObject({ aoe: { shape: 'burst', radius: 2 } });
  });

  it('rejects a non-positive radius', () => {
    expect(() => contentFileSchema.parse(spellFile({ shape: 'burst', radius: 0 }))).toThrow();
  });

  it('rejects an unknown shape', () => {
    expect(() => contentFileSchema.parse(spellFile({ shape: 'spiral', radius: 2 }))).toThrow();
  });

  it('accepts target.cone as a targeting id', () => {
    const file = spellFile({ shape: 'cone', radius: 3 });
    file.entries[0]!.targetingId = 'target.cone';
    expect(() => contentFileSchema.parse(file)).not.toThrow();
  });
});
