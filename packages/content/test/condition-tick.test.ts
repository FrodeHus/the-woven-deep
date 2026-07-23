import { describe, expect, it } from 'vitest';
import { contentFileSchema } from '../src/compiler/schema.js';

describe('condition tickEffects', () => {
  it('accepts a timed condition carrying a fire tick', () => {
    const parsed = contentFileSchema.parse({
      schemaVersion: 7,
      entries: [
        {
          kind: 'condition',
          id: 'condition.burning',
          name: 'Burning',
          description: 'Taking fire each turn.',
          color: '#e05a2b',
          duration: { mode: 'timed', default: 3, maximum: 5 },
          stacking: { mode: 'replace', maximumStacks: 1 },
          tickEffects: [
            {
              effectId: 'effect.damage',
              parameters: { damageType: 'fire', dice: { count: 1, sides: 2, bonus: 0 } },
              requiresLivingTarget: true,
            },
          ],
        },
      ],
    });
    expect(parsed.entries[0]).toMatchObject({ tickEffects: [{ effectId: 'effect.damage' }] });
  });

  it('defaults tickEffects to an empty array', () => {
    const parsed = contentFileSchema.parse({
      schemaVersion: 7,
      entries: [
        {
          kind: 'condition',
          id: 'condition.slow',
          name: 'Slow',
          description: 'Sluggish.',
          color: '#4488cc',
          duration: { mode: 'timed', default: 2, maximum: 4 },
          stacking: { mode: 'replace', maximumStacks: 1 },
          modifiersPerStack: { defense: -1 },
        },
      ],
    });
    expect(parsed.entries[0]).toMatchObject({ tickEffects: [] });
  });
});
