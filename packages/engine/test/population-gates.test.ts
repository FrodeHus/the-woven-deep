import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { EncounterContentEntry } from '@woven-deep/content';
import {
  createEncounterRunDecisions,
  createDemoRun,
  decodeActiveRun,
  deriveRngStreams,
  evaluateDiscoveryProtection,
  encodeActiveRun,
  markEncounterObserved,
  nextUint32,
  recordReachedEncounterDepths,
  type EncounterRunDecision,
  type Uint32State,
} from '../src/index.js';
import { encounterGateInputArbitrary } from './arbitraries.js';

function encounter(input: Readonly<{
  id: string;
  chance: number;
  increment?: number;
  cap?: number;
  minDepth?: number;
  maxDepth?: number;
}>): EncounterContentEntry {
  return {
    kind: 'encounter', id: input.id, name: input.id, adminDescription: null, tags: [], model: 'individual',
    minDepth: input.minDepth ?? 1, maxDepth: input.maxDepth ?? 5,
    environmentTags: [], requiredVaultTags: [], weight: 1, rarity: 'common',
    runAppearanceChance: input.chance, discoveryProtectionIncrement: input.increment ?? 0.1,
    discoveryProtectionCap: input.cap ?? 1, maximumInstancesPerRun: 1,
    placement: { minimumStairDistance: 0, minimumObjectiveDistance: 0, maximumMemberDistance: 0,
      allowedTerrainTags: [], requiresVaultSlot: false, failureMode: 'optional' },
    intentPresentation: { visible: true },
    definition: { monsterId: 'monster.test', minimumQuantity: 1, maximumQuantity: 1 },
  };
}

const state = [1, 2, 3, 4] as const;

describe('encounter run gates', () => {
  it('processes sorted encounters, clamps protection, and draws exactly once at probability boundaries', () => {
    const entries = [
      encounter({ id: 'encounter.z', chance: 1 }),
      encounter({ id: 'encounter.a', chance: 0, increment: 0.1, cap: 0.4 }),
      encounter({ id: 'encounter.m', chance: 0.5, increment: 0.1, cap: 0.7 }),
    ];
    const result = createEncounterRunDecisions({
      encounters: entries,
      protectionBonuses: [{ encounterId: 'encounter.m', bonus: 0.2 }],
      state,
    });
    let expectedState: Uint32State = state;
    for (let index = 0; index < entries.length; index += 1) expectedState = nextUint32(expectedState).state;

    expect(result.decisions.map((decision) => decision.encounterId))
      .toEqual(['encounter.a', 'encounter.m', 'encounter.z']);
    expect(result.decisions).toMatchObject([
      { baseProbability: 0, protectionBonus: 0, effectiveProbability: 0, eligible: false },
      { baseProbability: 0.5, protectionBonus: 0.2, effectiveProbability: 0.7, eligible: true },
      { baseProbability: 1, protectionBonus: 0, effectiveProbability: 1, eligible: true },
    ]);
    expect(result.state).toEqual(expectedState);
    expect(state).toEqual([1, 2, 3, 4]);
  });

  it('rejects unsorted, duplicate, unknown, negative, and excessive protection inputs', () => {
    const entries = [encounter({ id: 'encounter.a', chance: 0.2, cap: 0.5 }), encounter({ id: 'encounter.b', chance: 0.2 })];
    expect(() => createEncounterRunDecisions({ encounters: entries, state, protectionBonuses: [
      { encounterId: 'encounter.b', bonus: 0 }, { encounterId: 'encounter.a', bonus: 0 },
    ] })).toThrow(/sorted/i);
    expect(() => createEncounterRunDecisions({ encounters: entries, state, protectionBonuses: [
      { encounterId: 'encounter.a', bonus: 0 }, { encounterId: 'encounter.a', bonus: 0 },
    ] })).toThrow(/duplicate/i);
    expect(() => createEncounterRunDecisions({ encounters: entries, state, protectionBonuses: [
      { encounterId: 'encounter.missing', bonus: 0 },
    ] })).toThrow(/unknown/i);
    expect(() => createEncounterRunDecisions({ encounters: entries, state, protectionBonuses: [
      { encounterId: 'encounter.a', bonus: -0.1 },
    ] })).toThrow(/bonus/i);
    expect(() => createEncounterRunDecisions({ encounters: entries, state, protectionBonuses: [
      { encounterId: 'encounter.a', bonus: 0.31 },
    ] })).toThrow(/cap/i);
  });

  it('is isolated from placement draws on the encounters stream', () => {
    const streams = deriveRngStreams([7, 8, 9, 10]);
    let placementState = streams.encounters;
    for (let index = 0; index < 20; index += 1) placementState = nextUint32(placementState).state;
    const entries = [encounter({ id: 'encounter.a', chance: 0.5 })];
    const left = createEncounterRunDecisions({ encounters: entries, protectionBonuses: [], state: streams['population-gates'] });
    const right = createEncounterRunDecisions({ encounters: entries, protectionBonuses: [], state: streams['population-gates'] });
    expect(left).toEqual(right);
    expect(placementState).not.toEqual(streams.encounters);
  });

  it('round-trips saved decisions and advanced gate state without rerolling', () => {
    const base = createDemoRun();
    const result = createEncounterRunDecisions({
      encounters: [encounter({ id: 'encounter.a', chance: 0.5 })],
      protectionBonuses: [],
      state: base.rng['population-gates'],
    });
    const saved = decodeActiveRun(encodeActiveRun({
      ...base,
      rng: { ...base.rng, 'population-gates': result.state },
      encounterDecisions: result.decisions,
    }));
    expect(saved.encounterDecisions).toEqual(result.decisions);
    expect(saved.rng['population-gates']).toEqual(result.state);
  });
});

describe('discovery protection outcomes', () => {
  const entries = [
    encounter({ id: 'encounter.a', chance: 0.2, increment: 0.2, cap: 0.5, minDepth: 1, maxDepth: 3 }),
    encounter({ id: 'encounter.b', chance: 0.4, increment: 0.2, cap: 0.7, minDepth: 4, maxDepth: 6 }),
    encounter({ id: 'encounter.c', chance: 0.5, increment: 0.1, cap: 0.6, minDepth: 7, maxDepth: 9 }),
  ];

  function decisions(): readonly EncounterRunDecision[] {
    return createEncounterRunDecisions({
      encounters: entries,
      protectionBonuses: [{ encounterId: 'encounter.a', bonus: 0.1 }, { encounterId: 'encounter.b', bonus: 0.3 }],
      state,
    }).decisions;
  }

  it('tracks reached depth and observation separately from generation', () => {
    const reached = recordReachedEncounterDepths({ decisions: decisions(), encounters: entries, reachedDepths: [0, 2, 5] });
    const generated = reached.map((decision) => decision.encounterId === 'encounter.a'
      ? { ...decision, instancesCreated: 1 } : decision);
    expect(generated.find((decision) => decision.encounterId === 'encounter.a')).toMatchObject({
      reachedEligibleDepth: true, encountered: false, instancesCreated: 1,
    });
    const observed = markEncounterObserved(generated, 'encounter.a');
    expect(observed.find((decision) => decision.encounterId === 'encounter.a')?.encountered).toBe(true);
    expect(() => markEncounterObserved(reached, 'encounter.a')).toThrow(/instance/i);
  });

  it('resets observed encounters, increments reached unseen encounters to cap, and preserves unreached bonuses', () => {
    const reached = recordReachedEncounterDepths({ decisions: decisions(), encounters: entries, reachedDepths: [2, 5] })
      .map((decision) => decision.encounterId === 'encounter.a'
        ? { ...decision, instancesCreated: 1, encountered: true } : decision);
    expect(evaluateDiscoveryProtection({ decisions: reached, encounters: entries })).toEqual([
      { encounterId: 'encounter.a', previousBonus: 0.1, nextBonus: 0, outcome: 'encountered' },
      { encounterId: 'encounter.b', previousBonus: 0.3, nextBonus: 0.3, outcome: 'reached-unseen' },
      { encounterId: 'encounter.c', previousBonus: 0, nextBonus: 0, outcome: 'unreached' },
    ]);
  });
});

describe('encounter gate properties', () => {
  it('keeps decisions ordered and bounded over 500 generated inputs', () => {
    fc.assert(fc.property(encounterGateInputArbitrary, ({ encounters, bonuses, state: randomState }) => {
      const result = createEncounterRunDecisions({ encounters, protectionBonuses: bonuses, state: randomState });
      expect(result.decisions.map((entry) => entry.encounterId))
        .toEqual([...result.decisions.map((entry) => entry.encounterId)].sort());
      for (const decision of result.decisions) {
        expect(decision.effectiveProbability).toBeGreaterThanOrEqual(0);
        expect(decision.effectiveProbability).toBeLessThanOrEqual(1);
      }
      expect(evaluateDiscoveryProtection({ decisions: result.decisions, encounters }))
        .toEqual(evaluateDiscoveryProtection({ decisions: result.decisions, encounters }));
    }), { seed: 0x4b01, numRuns: 500 });
  });

  it('keeps gate output isolated from arbitrary placement draws over 500 seeds', () => {
    fc.assert(fc.property(
      fc.tuple(fc.nat(), fc.nat(), fc.nat(), fc.integer({ min: 1, max: 0xffff_ffff })),
      fc.integer({ min: 0, max: 100 }),
      (seed, placementDraws) => {
        const streams = deriveRngStreams(seed as Uint32State);
        let placementState = streams.encounters;
        for (let index = 0; index < placementDraws; index += 1) placementState = nextUint32(placementState).state;
        const entry = encounter({ id: 'encounter.a', chance: 0.5 });
        expect(createEncounterRunDecisions({ encounters: [entry], state: streams['population-gates'] }))
          .toEqual(createEncounterRunDecisions({ encounters: [entry], state: streams['population-gates'] }));
        if (placementDraws > 0) expect(placementState).not.toEqual(streams.encounters);
      },
    ), { seed: 0x4b02, numRuns: 500 });
  });
});
