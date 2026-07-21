import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { BalanceContentEntry, CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  ATTRIBUTE_ORDER,
  heroFromChoices,
  pointBuyCost,
  pointBuyValid,
  rerollAttributes,
  rollAttributes,
  validateHeroChoices,
  type HeroChoices,
} from '../src/index.js';
import type { Uint32State } from '../src/index.js';
import { propertyRuns } from './arbitraries.js';

let pack: CompiledContentPack;
let balance: BalanceContentEntry;

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
  balance = pack.entries.find((entry) => entry.kind === 'balance') as BalanceContentEntry;
});

const SEED: Uint32State = [9, 8, 7, 6];

function baseAttributes(value: number) {
  return Object.fromEntries(ATTRIBUTE_ORDER.map((name) => [name, value])) as Record<
    (typeof ATTRIBUTE_ORDER)[number],
    number
  >;
}

function wayfarerBladeChoices(overrides: Partial<HeroChoices> = {}): HeroChoices {
  return {
    name: 'Rogue',
    method: 'roll',
    attributes: { might: 10, agility: 10, vitality: 10, wits: 10, resolve: 10 },
    classId: 'class.wayfarer',
    kitId: 'blade',
    backgroundId: 'background.caravan-guard',
    traitIds: [],
    ...overrides,
  };
}

function lamplighterLanternChoices(): HeroChoices {
  return {
    name: 'Lamplighter',
    method: 'roll',
    attributes: { might: 10, agility: 10, vitality: 10, wits: 10, resolve: 10 },
    classId: 'class.lamplighter',
    kitId: 'lantern',
    backgroundId: 'background.deep-miner',
    traitIds: ['trait.sure-footed'],
  };
}

describe('rollAttributes', () => {
  it('rolls 3d6 per attribute deterministically and within bounds', () => {
    const first = rollAttributes(SEED);
    const second = rollAttributes(SEED);
    expect(first).toEqual(second);
    for (const name of ATTRIBUTE_ORDER) {
      expect(first.attributes[name]).toBeGreaterThanOrEqual(3);
      expect(first.attributes[name]).toBeLessThanOrEqual(18);
    }
  });

  it('reroll consumes a disjoint draw sequence', () => {
    const first = rollAttributes(SEED);
    const rerolled = rerollAttributes(first);
    expect(rerolled.attributes).not.toEqual(first.attributes);
    expect(rerolled.state).not.toEqual(first.state);
  });

  it('is deterministic and bounded across many seeds (property)', () => {
    fc.assert(
      fc.property(
        fc.tuple(
          fc.integer({ min: 1, max: 0xffffffff }),
          fc.nat(0xffffffff),
          fc.nat(0xffffffff),
          fc.nat(0xffffffff),
        ),
        ([a, b, c, d]) => {
          const seed: Uint32State = [a, b, c, d];
          const first = rollAttributes(seed);
          const second = rollAttributes(seed);
          expect(first).toEqual(second);
          for (const name of ATTRIBUTE_ORDER) {
            expect(first.attributes[name]).toBeGreaterThanOrEqual(3);
            expect(first.attributes[name]).toBeLessThanOrEqual(18);
          }
          const rerolled = rerollAttributes(first);
          for (const name of ATTRIBUTE_ORDER) {
            expect(rerolled.attributes[name]).toBeGreaterThanOrEqual(3);
            expect(rerolled.attributes[name]).toBeLessThanOrEqual(18);
          }
        },
      ),
      { numRuns: propertyRuns(200) },
    );
  });
});

describe('pointBuyCost', () => {
  it('computes cost from the table with exact budget edges', () => {
    const allMin = baseAttributes(0);
    expect(pointBuyCost(allMin, balance.pointBuy)).toBe(0);
    expect(pointBuyValid(allMin, balance)).toBe(true);

    // 30 budget: a block of all-6 attributes costs 6 * 5 = 30, exactly at budget.
    const atBudget = baseAttributes(6);
    expect(pointBuyCost(atBudget, balance.pointBuy)).toBe(30);
    expect(pointBuyValid(atBudget, balance)).toBe(true);

    // Bump one attribute by 1 (cost 7 instead of 6) to go one over budget.
    const overBudget = { ...atBudget, might: 7 };
    expect(pointBuyCost(overBudget, balance.pointBuy)).toBe(31);
    expect(pointBuyValid(overBudget, balance)).toBe(false);
  });

  it('is checked-integer and guards against a poisoned cost table', () => {
    const poisoned = {
      budget: Number.MAX_SAFE_INTEGER,
      costs: [{ value: 10, cost: Number.MAX_SAFE_INTEGER }],
    };
    expect(() => pointBuyCost(baseAttributes(10), poisoned)).toThrow(RangeError);
  });

  it('throws when the table has no row for a rolled value', () => {
    expect(() => pointBuyCost(baseAttributes(31), balance.pointBuy)).toThrow();
  });
});

describe('validateHeroChoices', () => {
  const cases: Array<[string, (choices: HeroChoices) => HeroChoices, RegExp]> = [
    ['locked class', (c) => ({ ...c, classId: 'class.archivist' }), /classId/],
    ['unknown class', (c) => ({ ...c, classId: 'class.nonexistent' }), /classId/],
    ['foreign kitId', (c) => ({ ...c, kitId: 'lantern' }), /kitId/],
    [
      'unknown background',
      (c) => ({ ...c, backgroundId: 'background.nonexistent' }),
      /backgroundId/,
    ],
    [
      '3 traits',
      (c) => ({ ...c, traitIds: ['trait.keen-eyed', 'trait.sure-footed', 'trait.brawler'] }),
      /traitIds/,
    ],
    [
      'duplicate traits',
      (c) => ({ ...c, traitIds: ['trait.keen-eyed', 'trait.keen-eyed'] }),
      /traitIds/,
    ],
    ['unknown trait', (c) => ({ ...c, traitIds: ['trait.nonexistent'] }), /traitIds/],
    [
      'out-of-bounds attribute',
      (c) => ({ ...c, attributes: { ...c.attributes, might: balance.attributeMaximum + 1 } }),
      /attributes/,
    ],
    [
      'over-budget point buy',
      (c) => ({ ...c, method: 'point-buy', attributes: baseAttributes(30) }),
      /point-buy|budget/,
    ],
    ['invalid name (empty)', (c) => ({ ...c, name: '   ' }), /name/],
    ['invalid name (too long)', (c) => ({ ...c, name: 'x'.repeat(25) }), /name/],
    ['invalid name (illegal chars)', (c) => ({ ...c, name: 'Rogue!!' }), /name/],
  ];

  it.each(cases)('rejects %s', (_label, mutate, messagePattern) => {
    const choices = mutate(wayfarerBladeChoices());
    expect(() => validateHeroChoices({ pack, choices })).toThrow(messagePattern);
  });

  it('accepts a well-formed roll choice', () => {
    expect(() => validateHeroChoices({ pack, choices: wayfarerBladeChoices() })).not.toThrow();
  });

  it('accepts a well-formed point-buy choice at exact budget', () => {
    const choices = wayfarerBladeChoices({ method: 'point-buy', attributes: baseAttributes(6) });
    expect(() => validateHeroChoices({ pack, choices })).not.toThrow();
  });
});

describe('heroFromChoices', () => {
  it('assembles kit + background extras + merged modifiers', () => {
    const hero = heroFromChoices({ pack, choices: lamplighterLanternChoices() });
    expect(hero.classTags).toEqual(['lamplighter']);
    expect(hero.equipped).toEqual(
      expect.arrayContaining([expect.objectContaining({ contentId: 'item.brass-lantern' })]),
    );
    expect(hero.backpack).toEqual(
      expect.arrayContaining([expect.objectContaining({ contentId: 'item.lamp-oil' })]),
    );
    expect(hero.statModifiers).toEqual({ search: 1, defense: 1 });
  });

  it('normalizes the hero name (trim + NFC)', () => {
    const hero = heroFromChoices({ pack, choices: wayfarerBladeChoices({ name: '  Rogue  ' }) });
    expect(hero.name).toBe('Rogue');
  });

  it('output always passes validateHeroChoices (property)', () => {
    const classIds = ['class.wayfarer', 'class.lamplighter'] as const;
    const kitsByClass: Record<string, readonly string[]> = {
      'class.wayfarer': ['blade', 'ranger'],
      'class.lamplighter': ['lantern', 'torchbearer'],
    };
    const backgroundIds = [
      'background.caravan-guard',
      'background.deep-miner',
      'background.ratcatcher',
    ] as const;
    const traitIds = [
      'trait.keen-eyed',
      'trait.sure-footed',
      'trait.steady-hands',
      'trait.brawler',
      'trait.sharpshooter',
    ] as const;

    const arb = fc.record({
      seed: fc.tuple(
        fc.integer({ min: 1, max: 0xffffffff }),
        fc.nat(0xffffffff),
        fc.nat(0xffffffff),
        fc.nat(0xffffffff),
      ),
      classId: fc.constantFrom(...classIds),
      backgroundId: fc.constantFrom(...backgroundIds),
      traitIds: fc.uniqueArray(fc.constantFrom(...traitIds), { maxLength: 2 }),
      name: fc.constantFrom('Rogue', 'A', "O'Malley", 'Anne-Marie', 'Wanderer 7'),
    });

    fc.assert(
      fc.property(arb, ({ seed, classId, backgroundId, traitIds: traits, name }) => {
        const kitId = kitsByClass[classId]![0]!;
        const roll = rollAttributes(seed as Uint32State);
        const choices: HeroChoices = {
          name,
          method: 'roll',
          attributes: roll.attributes,
          classId,
          kitId,
          backgroundId,
          traitIds: traits,
        };
        const hero = heroFromChoices({ pack, choices });
        expect(() => validateHeroChoices({ pack, choices })).not.toThrow();
        expect(hero.name).toBe(name);
      }),
      { numRuns: propertyRuns(200) },
    );
  });

  // Regression lock for the checked-integer guard on the modifier merge (`mergeModifiers` in
  // chargen.ts, via its shared `checkedAdd`/`safeInteger` helpers): a background and a trait each
  // poisoned with a near-MAX_SAFE_INTEGER value on the SAME derived stat must throw a RangeError
  // rather than silently overflowing into an unsafe/incorrect merged modifier.
  it('throws a RangeError instead of silently overflowing when merged background+trait modifiers exceed safe integer arithmetic', () => {
    const poisonedPack: CompiledContentPack = {
      ...pack,
      entries: pack.entries.map((entry) => {
        if (entry.kind === 'background' && entry.id === 'background.caravan-guard') {
          return { ...entry, modifiers: { search: Number.MAX_SAFE_INTEGER } };
        }
        if (entry.kind === 'trait' && entry.id === 'trait.keen-eyed') {
          return { ...entry, modifiers: { search: Number.MAX_SAFE_INTEGER } };
        }
        return entry;
      }),
    };
    const choices = wayfarerBladeChoices({
      backgroundId: 'background.caravan-guard',
      traitIds: ['trait.keen-eyed'],
    });

    expect(() => heroFromChoices({ pack: poisonedPack, choices })).toThrow(RangeError);
  });
});
