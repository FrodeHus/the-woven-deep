import { describe, expect, it } from 'vitest';
import type { ConditionContentEntry } from '@woven-deep/content';
import {
  conditionModifiers,
  createDemoContentPack,
  createDemoRun,
  deriveActorStats,
  populationDerivedStatModifier,
  type ActorDerivationInput,
} from '../src/index.js';

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
      lightOutRevealRadius: { base: 1 },
      lightOutMemoryPersists: { base: 0 },
    },
    equipmentModifiers: [
      {
        meleeAccuracy: -7,
        meleeDamageBonus: -8,
        rangedAccuracy: -8,
        defense: -6,
        search: -4,
        disarm: -17,
      },
    ],
    conditionModifiers: [{ maxHealth: 0 }],
  };
}

const TENS = { might: 10, agility: 10, vitality: 10, wits: 10, resolve: 10 };

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
      lightOutRevealRadius: 1,
      lightOutMemoryPersists: 0,
    });
    expect(input).toEqual(before);
  });

  it('rejects unsafe operands and arithmetic overflow', () => {
    expect(() =>
      deriveActorStats({ ...fixture(), attributes: { ...fixture().attributes, might: 1.5 } }),
    ).toThrow(/might.*safe integer/i);
    expect(() =>
      deriveActorStats({
        ...fixture(),
        attributes: { ...fixture().attributes, might: Number.MAX_SAFE_INTEGER },
        formulas: { ...fixture().formulas, meleeAccuracy: { might: 2 } },
      }),
    ).toThrow(/meleeAccuracy.*safe integer/i);
  });

  it('accepts modifiers derived from YAML condition definitions', () => {
    const condition: ConditionContentEntry = {
      kind: 'condition',
      id: 'condition.clumsy',
      name: 'Clumsy',
      description: 'Less defensive',
      tags: [],
      color: '#ffffff',
      duration: { mode: 'timed', default: 10, maximum: 10 },
      stacking: { mode: 'intensify', maximumStacks: 3 },
      modifiersPerStack: { defense: -2 },
      traits: [],
    };
    const content = {
      ...createDemoContentPack(),
      entries: [...createDemoContentPack().entries, condition],
    };
    const actor = {
      ...createDemoRun().actors[0]!,
      conditions: [
        { conditionId: condition.id, sourceActorId: null, appliedAt: 0, expiresAt: 10, stacks: 2 },
      ],
    };
    expect(
      deriveActorStats({ ...fixture(), conditionModifiers: conditionModifiers(actor, content) })
        .defense,
    ).toBe(8);
  });

  it('folds hero modifiers after condition modifiers and still guards unknown keys', () => {
    const formulas = fixture().formulas;
    expect(
      deriveActorStats({
        attributes: TENS,
        formulas,
        equipmentModifiers: [],
        conditionModifiers: [],
        heroModifiers: [{ search: 2 }],
      }).search,
    ).toBe(12);
    expect(() =>
      deriveActorStats({
        attributes: TENS,
        formulas,
        equipmentModifiers: [],
        conditionModifiers: [],
        heroModifiers: [{ notAStat: 1 } as unknown as Partial<Record<'search', number>>],
      }),
    ).toThrow(/unknown stat/i);
  });

  it('maps group combat bonuses into derived actor stats without hidden mutation', () => {
    const modifiers = { accuracy: 2, defense: 3, damage: 4 };
    expect(populationDerivedStatModifier(modifiers)).toEqual({
      meleeAccuracy: 2,
      rangedAccuracy: 2,
      defense: 3,
      meleeDamageBonus: 4,
    });
    expect(modifiers).toEqual({ accuracy: 2, defense: 3, damage: 4 });
  });
});
