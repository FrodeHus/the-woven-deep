import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileContentDirectory } from '../src/compiler/index.js';
import { ContentCompileError } from '../src/compiler/error.js';

const balanceWithCurseChance = (chance: number): string =>
  `{kind: balance, startingCurrency: 40, id: balance.core, name: Core, tags: [core], readinessThreshold: 100, normalActionCost: 100, speedMinimum: 25, speedMaximum: 400, energyMinimum: -10000, energyMaximum: 10000, attributeMinimum: 0, attributeMaximum: 30, hungerMaximum: 5000, hungerThresholds: {hungry: 1500, weak: 500, starving: 0}, starvationInterval: 500, starvationDamage: 1, starvationDamageIncrement: 0, starvationDamageMaximum: 1, recoveryInterval: 500, recoveryAmount: 1, weaveRegenAmount: 2, restMaximumDuration: 5000, recoveryByHungerStage: {sated: 100, hungry: 50, weak: 0, starving: 0}, hungerStageModifiers: {sated: {}, hungry: {}, weak: {}, starving: {}}, formulas: {health: {base: 8, vitality: 2}}, actionCosts: {action.move: 100}, score: {depthCoefficient: 100, bossDefeatCoefficient: 250, threatCoefficient: 5, discoveryCoefficient: 25, completionBonus: {died: 0, refused: 400, became-heart: 800, broke-cycle: 1500}, turnEfficiencyBudget: 500, turnEfficiencyDecayInterval: 200}, pointBuy: {budget: 1, costs: [${Array.from({ length: 31 }, (_, value) => `{value: ${value}, cost: 0}`).join(', ')}]}, restockMilestones: [5, 10, 15, 20], house: {baseCapacity: 6, strongboxIncrement: 4}, encounterDensity: {monstersPerThousandWalkable: {shallow: 7, mid: 8, deep: 10}, attemptCap: 16}, curses: { chanceBps: { shallow: ${chance}, mid: ${chance}, deep: ${chance} }, enchantedMultiplierBps: 20000, capBps: 5000 }, fragmentSpawnRollDenominator: 40, generation: {doorTilePercent: 35, artifactOfferPercent: 12}, tempering: {depths: [3]}, spellPowerDivisor: 4, enchanting: {rarityMagnitudeBps: {common: 10000, uncommon: 12500, rare: 15000, legendary: 20000}}, floorLoot: {scatterCount: {minimum: 2, maximum: 4}, chestCount: {minimum: 0, maximum: 2}, lockedChestPercent: 50, lockedDoorPercent: 15, minimumAnchorDistance: 8, minimumSpreadDistance: 6, depthBands: {shallowMaxDepth: 6, midMaxDepth: 13}, chestLockDifficulty: {shallow: 10, mid: 13, deep: 16}}}`;

const compactItem =
  '{kind: item, id: item.test-trinket, name: Test trinket, glyph: "*", color: "#e37b46", tags: [misc], minDepth: 1, maxDepth: 20, category: misc, stackLimit: 3, price: 15, rarity: uncommon, actionCost: 100, equipment: null, combat: null, light: null, artifact: null, identification: {mode: known, poolId: null}, effects: []}';

const compactVault =
  '{kind: vault, id: vault.test-room, name: Test room, tags: [test], minDepth: 1, maxDepth: 5, rarity: common, weight: 10, maxPerFloor: 1, margin: 1, transforms: {rotations: [0, 180], reflectHorizontal: true}, layout: ["#####", "#+m.#", "#####"], legend: {"#": {terrain: wall}, ".": {terrain: floor}, "+": {terrain: floor, entrance: true}, m: {terrain: floor, slot: {id: monster-main, kind: monster, required: true, tags: [guard]}}}}';

const compactMonster =
  '{kind: monster, id: monster.rat, name: Rat, glyph: r, color: "#aaaaaa", tags: [defense, food, healing, identification, light, offense], minDepth: 1, maxDepth: 5, attributes: {might: 3, agility: 8, vitality: 4, wits: 2, resolve: 2}, health: 4, speed: 110, accuracy: 1, defense: 10, perception: 6, damage: {count: 1, sides: 3, bonus: 0}, armor: 0, resistances: {physical: 0, fire: 0, cold: 0, lightning: 0, poison: 0, arcane: 0}, disposition: hostile, behaviorId: behavior.approach-and-attack, behaviorParameters: {}, threat: 2, rarity: common}';

async function fixture(balance: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'woven-content-curse-crosscheck-'));
  await writeFile(
    join(root, 'pack.yaml'),
    `schemaVersion: 17\nentries: [${compactMonster}, ${compactItem}, ${compactVault}, ${balance}]\n`,
  );
  return root;
}

describe('curse chance / roster cross-check', () => {
  it('rejects a nonzero curses.chanceBps with no curse entries at compile time', async () => {
    // A pack in this shape used to compile clean and then throw at generation time, on the first
    // floor that rolled a curse -- mid-run, not at content:validate.
    const root = await fixture(balanceWithCurseChance(1000));
    await expect(compileContentDirectory({ rootDir: root })).rejects.toThrow(ContentCompileError);
    await expect(compileContentDirectory({ rootDir: root })).rejects.toThrow(
      /curse entry|curse entries/,
    );
  });

  it('accepts an all-zero curses.chanceBps with no curse entries', async () => {
    const root = await fixture(balanceWithCurseChance(0));
    const pack = await compileContentDirectory({ rootDir: root });
    expect(pack.entries.some((entry) => entry.kind === 'balance')).toBe(true);
  });
});

const compactCondition =
  '{kind: condition, id: condition.test-chill, name: Test chill, tags: [debuff], description: Cold., color: "#7fbfe0", duration: {mode: timed, default: 3, maximum: 6}, stacking: {mode: refresh, maximumStacks: 1}, modifiersPerStack: {meleeAccuracy: -1}}';

const curseWithDuration = (duration: number): string =>
  `{kind: curse, id: curse.test-tether, name: Test tether, tags: [curse], revealText: "It pulls.", drawbackModifiers: {maxWeave: -1}, trigger: {on: on-floor-enter, chanceBps: 3000, effect: {effectId: effect.condition.apply, parameters: {conditionId: condition.test-chill, duration: ${duration}}}}}`;

async function curseFixture(duration: number): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'woven-content-curse-duration-'));
  await writeFile(
    join(root, 'pack.yaml'),
    `schemaVersion: 17\nentries: [${compactMonster}, ${compactItem}, ${compactVault}, ${compactCondition}, ${curseWithDuration(duration)}, ${balanceWithCurseChance(1000)}]\n`,
  );
  return root;
}

describe('curse trigger effect validation', () => {
  it('rejects a trigger duration past the condition maximum at compile time', async () => {
    // Curse trigger effects were the one effect list never run through `effectIssues`, so a curse
    // could hand a timed condition a duration its own `maximum` forbids. That pack compiled clean
    // and then threw a RangeError out of `applyCondition` the first time the trigger's chance roll
    // happened to hit -- a mid-run crash no particular seed is guaranteed to surface.
    const root = await curseFixture(300);
    await expect(compileContentDirectory({ rootDir: root })).rejects.toThrow(ContentCompileError);
    await expect(compileContentDirectory({ rootDir: root })).rejects.toThrow(
      /duration 300 exceeds maximum 6/,
    );
  });

  it('accepts a trigger duration within the condition maximum', async () => {
    const root = await curseFixture(6);
    const pack = await compileContentDirectory({ rootDir: root });
    expect(pack.entries.some((entry) => entry.kind === 'curse')).toBe(true);
  });
});
