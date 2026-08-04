import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  compileContentDirectory,
  ContentCompileError,
  type ContentCompileIssue,
} from '../src/compiler/index.js';
import { CONTENT_SCHEMA_VERSION } from '../src/model.js';
import type { ConditionContentEntry, ContentEntry, MonsterContentEntry } from '../src/model.js';

const compactBalance =
  '{kind: balance, startingCurrency: 40, id: balance.core, name: Core, tags: [core], readinessThreshold: 100, normalActionCost: 100, speedMinimum: 25, speedMaximum: 400, energyMinimum: -10000, energyMaximum: 10000, attributeMinimum: 0, attributeMaximum: 30, hungerMaximum: 5000, hungerThresholds: {hungry: 1500, weak: 500, starving: 0}, starvationInterval: 500, starvationDamage: 1, recoveryInterval: 500, recoveryAmount: 1, weaveRegenAmount: 2, restMaximumDuration: 5000, recoveryByHungerStage: {sated: 100, hungry: 50, weak: 0, starving: 0}, hungerStageModifiers: {sated: {}, hungry: {}, weak: {}, starving: {}}, formulas: {health: {base: 8, vitality: 2}}, actionCosts: {action.move: 100}, score: {depthCoefficient: 100, bossDefeatCoefficient: 250, threatCoefficient: 5, discoveryCoefficient: 25, completionBonus: {died: 0, refused: 400, became-heart: 800, broke-cycle: 1500}, turnEfficiencyBudget: 500, turnEfficiencyDecayInterval: 200}, pointBuy: {budget: 1, costs: [{value: 0, cost: 0}, {value: 1, cost: 0}, {value: 2, cost: 0}, {value: 3, cost: 0}, {value: 4, cost: 0}, {value: 5, cost: 0}, {value: 6, cost: 0}, {value: 7, cost: 0}, {value: 8, cost: 0}, {value: 9, cost: 0}, {value: 10, cost: 0}, {value: 11, cost: 0}, {value: 12, cost: 0}, {value: 13, cost: 0}, {value: 14, cost: 0}, {value: 15, cost: 0}, {value: 16, cost: 0}, {value: 17, cost: 0}, {value: 18, cost: 0}, {value: 19, cost: 0}, {value: 20, cost: 0}, {value: 21, cost: 0}, {value: 22, cost: 0}, {value: 23, cost: 0}, {value: 24, cost: 0}, {value: 25, cost: 0}, {value: 26, cost: 0}, {value: 27, cost: 0}, {value: 28, cost: 0}, {value: 29, cost: 0}, {value: 30, cost: 0}]}, restockMilestones: [5, 10, 15, 20], house: {baseCapacity: 6, strongboxIncrement: 4}, encounterDensity: { monstersPerThousandWalkable: { shallow: 7, mid: 8, deep: 10 }, attemptCap: 16 }, curses: { chanceBps: { shallow: 0, mid: 0, deep: 0 }, enchantedMultiplierBps: 20000, capBps: 5000 }, fragmentSpawnRollDenominator: 40, generation: {doorTilePercent: 35, artifactOfferPercent: 12}, tempering: {depths: [3]}, spellPowerDivisor: 4, enchanting: {rarityMagnitudeBps: {common: 10000, uncommon: 12500, rare: 15000, legendary: 20000}}, floorLoot: {scatterCount: {minimum: 2, maximum: 4}, chestCount: {minimum: 0, maximum: 2}, lockedChestPercent: 50, lockedDoorPercent: 15, minimumAnchorDistance: 8, minimumSpreadDistance: 6, depthBands: {shallowMaxDepth: 6, midMaxDepth: 13}, chestLockDifficulty: {shallow: 10, mid: 13, deep: 16}}}';
const compactMonster =
  '{kind: monster, id: monster.rat, name: Rat, glyph: r, color: "#aaaaaa", tags: [defense, food, healing, identification, light, offense], minDepth: 1, maxDepth: 5, attributes: {might: 3, agility: 8, vitality: 4, wits: 2, resolve: 2}, health: 4, speed: 110, accuracy: 1, defense: 10, perception: 6, damage: {count: 1, sides: 3, bonus: 0}, armor: 0, resistances: {physical: 0, fire: 0, cold: 0, lightning: 0, poison: 0, arcane: 0}, disposition: hostile, behaviorId: behavior.approach-and-attack, behaviorParameters: {}, threat: 2, rarity: common}';
const compactItem =
  '{kind: item, id: item.lantern, name: Lantern, glyph: "¤", color: "#eeeeaa", tags: [defense, food, healing, identification, light, offense], minDepth: 1, maxDepth: 20, category: light, stackLimit: 1, price: 4, rarity: common, actionCost: 100, equipment: {slots: [off-hand], handedness: one-handed, reservedSlots: []}, combat: null, light: {color: [255, 200, 100], radius: 6, strength: 180, fuelCapacity: 1000, fuelPerTime: 1, warningThresholds: [100], fuelTags: [lamp-oil]}, artifact: null, identification: {mode: known, poolId: null}, effects: []}';
const compactVault =
  '{kind: vault, id: vault.test-room, name: Test room, tags: [test], minDepth: 1, maxDepth: 5, rarity: common, weight: 10, maxPerFloor: 1, margin: 1, transforms: {rotations: [0, 180], reflectHorizontal: true}, layout: ["#####", "#+m.#", "#####"], legend: {"#": {terrain: wall}, ".": {terrain: floor}, "+": {terrain: floor, entrance: true}, m: {terrain: floor, slot: {id: monster-main, kind: monster, required: true, tags: [guard]}}}}';
const compactVenomCondition =
  '{kind: condition, id: condition.venom, name: Venom, description: Venom in the blood., tags: [poison, debuff], color: "#7fae55", duration: {mode: timed, default: 5, maximum: 10}, stacking: {mode: refresh, maximumStacks: 1}, modifiersPerStack: {}, traits: []}';
const compactChillCondition =
  '{kind: condition, id: condition.chill, name: Chill, description: Cold in the bones., tags: [cold, debuff], color: "#80b8ff", duration: {mode: timed, default: 3, maximum: 6}, stacking: {mode: refresh, maximumStacks: 1}, modifiersPerStack: {}, traits: []}';

function contentFile(...entries: readonly string[]): string {
  return `schemaVersion: ${CONTENT_SCHEMA_VERSION}\nentries: [${entries.join(', ')}]\n`;
}

/** `monster.rat` with the supplied `onHitConditions` YAML fragment spliced onto its tail. */
function monsterWithRiders(riders: string): string {
  return compactMonster.replace(
    ', threat: 2, rarity: common}',
    `, threat: 2, rarity: common, onHitConditions: ${riders}}`,
  );
}

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'woven-poison-'));
  const completeFiles = {
    'foundation.yaml': contentFile(compactBalance, compactItem, compactVault),
    ...files,
  };
  for (const [path, source] of Object.entries(completeFiles)) {
    const target = join(root, path);
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, source);
  }
  return root;
}

async function expectCompileIssues(
  compilation: Promise<unknown>,
  expected: readonly ContentCompileIssue[],
): Promise<void> {
  let caught: unknown;
  try {
    await compilation;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ContentCompileError);
  expect((caught as ContentCompileError).issues).toEqual(expected);
}

async function loadPack() {
  return compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
}

function monstersOf(entries: readonly ContentEntry[]): MonsterContentEntry[] {
  return entries.filter((entry): entry is MonsterContentEntry => entry.kind === 'monster');
}

describe('monster onHitConditions schema', () => {
  it('compiles a monster carrying a rider and keeps the authored chance and duration', async () => {
    const root = await fixture({
      'content.yaml': contentFile(
        monsterWithRiders('[{conditionId: condition.venom, chance: 0.35, duration: 6}]'),
        compactVenomCondition,
      ),
    });
    const pack = await compileContentDirectory({ rootDir: root });
    expect(pack.entries.find((entry) => entry.id === 'monster.rat')).toMatchObject({
      onHitConditions: [{ conditionId: 'condition.venom', chance: 0.35, duration: 6 }],
    });
  });

  it('defaults a monster with no riders to an empty list and a null duration override', async () => {
    const root = await fixture({
      'content.yaml': contentFile(
        compactMonster,
        monsterWithRiders('[{conditionId: condition.venom, chance: 0.5}]').replace(
          'monster.rat',
          'monster.tick',
        ),
        compactVenomCondition,
      ),
    });
    const pack = await compileContentDirectory({ rootDir: root });
    expect(pack.entries.find((entry) => entry.id === 'monster.rat')).toMatchObject({
      onHitConditions: [],
    });
    expect(pack.entries.find((entry) => entry.id === 'monster.tick')).toMatchObject({
      onHitConditions: [{ conditionId: 'condition.venom', chance: 0.5, duration: null }],
    });
  });

  it('rejects riders that are not sorted by condition id', async () => {
    const root = await fixture({
      'content.yaml': contentFile(
        monsterWithRiders(
          '[{conditionId: condition.venom, chance: 0.5}, {conditionId: condition.chill, chance: 0.5}]',
        ),
        compactVenomCondition,
        compactChillCondition,
      ),
    });
    await expectCompileIssues(compileContentDirectory({ rootDir: root }), [
      {
        file: 'content.yaml',
        path: '$.entries.monster.rat.onHitConditions.1',
        message: 'on-hit conditions must be unique and sorted by condition id',
      },
    ]);
  });

  it('rejects a duplicated rider condition', async () => {
    const root = await fixture({
      'content.yaml': contentFile(
        monsterWithRiders(
          '[{conditionId: condition.venom, chance: 0.5}, {conditionId: condition.venom, chance: 0.2}]',
        ),
        compactVenomCondition,
      ),
    });
    await expectCompileIssues(compileContentDirectory({ rootDir: root }), [
      {
        file: 'content.yaml',
        path: '$.entries.monster.rat.onHitConditions.1',
        message: 'on-hit conditions must be unique and sorted by condition id',
      },
    ]);
  });

  it('rejects a rider pointing at an unknown condition', async () => {
    const root = await fixture({
      'content.yaml': contentFile(
        monsterWithRiders('[{conditionId: condition.absent, chance: 1}]'),
      ),
    });
    await expectCompileIssues(compileContentDirectory({ rootDir: root }), [
      {
        file: 'content.yaml',
        path: '$.entries.monster.rat.onHitConditions.0.conditionId',
        message: 'unknown condition reference condition.absent',
      },
    ]);
  });

  it('rejects a rider pointing at an entry that is not a condition', async () => {
    const root = await fixture({
      'content.yaml': contentFile(monsterWithRiders('[{conditionId: balance.core, chance: 1}]')),
    });
    await expectCompileIssues(compileContentDirectory({ rootDir: root }), [
      {
        file: 'content.yaml',
        path: '$.entries.monster.rat.onHitConditions.0.conditionId',
        message: 'condition reference balance.core resolves to balance',
      },
    ]);
  });

  it('rejects a duration override above the condition maximum', async () => {
    const root = await fixture({
      'content.yaml': contentFile(
        monsterWithRiders('[{conditionId: condition.venom, chance: 1, duration: 99}]'),
        compactVenomCondition,
      ),
    });
    await expectCompileIssues(compileContentDirectory({ rootDir: root }), [
      {
        file: 'content.yaml',
        path: '$.entries.monster.rat.onHitConditions.0.duration',
        message: 'duration 99 exceeds maximum 10',
      },
    ]);
  });
});

describe('the shipped poison roster', () => {
  it('ships a poison condition that deals poison damage every tick', async () => {
    const pack = await loadPack();
    const poisoned = pack.entries.find(
      (entry): entry is ConditionContentEntry =>
        entry.kind === 'condition' && entry.id === 'condition.poisoned',
    );
    expect(poisoned).toBeDefined();
    expect(poisoned?.tags).toContain('poison');
    expect(poisoned?.tickEffects).toContainEqual(
      expect.objectContaining({
        effectId: 'effect.damage',
        parameters: expect.objectContaining({ damageType: 'poison' }),
      }),
    );
  });

  it('gives every poison-tagged monster a way to actually poison the hero', async () => {
    const pack = await loadPack();
    const venomous = monstersOf(pack.entries).filter((monster) => monster.tags.includes('poison'));
    expect(venomous.length).toBeGreaterThanOrEqual(5);
    for (const monster of venomous) {
      expect(
        monster.onHitConditions.map((rider) => rider.conditionId),
        `${monster.id} is tagged poison but applies no condition`,
      ).toContain('condition.poisoned');
    }
  });

  it('leaves monsters that never advertised venom without a poison rider', async () => {
    const pack = await loadPack();
    const untagged = monstersOf(pack.entries).filter((monster) => !monster.tags.includes('poison'));
    for (const monster of untagged) {
      expect(
        monster.onHitConditions.map((rider) => rider.conditionId),
        `${monster.id} poisons without being tagged poison`,
      ).not.toContain('condition.poisoned');
    }
  });
});
