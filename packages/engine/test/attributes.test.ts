import { describe, expect, it } from 'vitest';
import { deriveActorStats, type ActorDerivationInput } from '../src/index.js';

function fixture(): ActorDerivationInput {
  return {
    attributes: { might: 10, agility: 12, vitality: 8, wits: 9, resolve: 7 },
    formulas: {
      maxHealth: { base: 8, vitality: 2 },
      meleeAccuracy: { might: 1 },
      meleeDamageBonus: { might: 1 },
      rangedAccuracy: { agility: 1 },
      defense: { base: 6, agility: 1 },
      search: { wits: 1 },
      disarm: { agility: 1, wits: 1 },
    },
    equipmentModifiers: [
      { meleeAccuracy: -7, meleeDamageBonus: -8, rangedAccuracy: -8, defense: -6, search: -4, disarm: -17 },
    ],
    conditionModifiers: [{ maxHealth: 0 }],
  };
}

describe('deriveActorStats', () => {
  it('derives stats from attributes, equipment, and conditions without mutating input', () => {
    const input = fixture();
    const before = structuredClone(input);

    expect(deriveActorStats(input)).toEqual({
      maxHealth: 24,
      meleeAccuracy: 3,
      meleeDamageBonus: 2,
      rangedAccuracy: 4,
      defense: 12,
      search: 5,
      disarm: 4,
    });
    expect(input).toEqual(before);
  });

  it('rejects unsafe operands and arithmetic overflow', () => {
    expect(() => deriveActorStats({ ...fixture(), attributes: { ...fixture().attributes, might: 1.5 } }))
      .toThrow(/might.*safe integer/i);
    expect(() => deriveActorStats({
      ...fixture(),
      attributes: { ...fixture().attributes, might: Number.MAX_SAFE_INTEGER },
      formulas: { ...fixture().formulas, meleeAccuracy: { might: 2 } },
    })).toThrow(/meleeAccuracy.*safe integer/i);
  });
});
