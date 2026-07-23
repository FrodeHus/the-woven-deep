import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileContentDirectory } from '../src/compiler/index.js';

const compactMonster =
  '{kind: monster, id: monster.rat, name: Rat, glyph: r, color: "#aaaaaa", tags: [defense, food, healing, identification, light, offense], minDepth: 1, maxDepth: 5, attributes: {might: 3, agility: 8, vitality: 4, wits: 2, resolve: 2}, health: 4, speed: 110, accuracy: 1, defense: 10, perception: 6, damage: {count: 1, sides: 3, bonus: 0}, armor: 0, resistances: {physical: 0, fire: 0, cold: 0, lightning: 0, poison: 0, arcane: 0}, disposition: hostile, behaviorId: behavior.approach-and-attack, behaviorParameters: {}, threat: 2, rarity: common}';
const compactVault =
  '{kind: vault, id: vault.test-room, name: Test room, tags: [test], minDepth: 1, maxDepth: 5, rarity: common, weight: 10, maxPerFloor: 1, margin: 1, transforms: {rotations: [0, 180], reflectHorizontal: true}, layout: ["#####", "#+m.#", "#####"], legend: {"#": {terrain: wall}, ".": {terrain: floor}, "+": {terrain: floor, entrance: true}, m: {terrain: floor, slot: {id: monster-main, kind: monster, required: true, tags: [guard]}}}}';
const compactSpell =
  '{kind: spell, id: spell.test-bolt, name: Test bolt, tags: [fire], targetingId: target.actor, range: 6, actionCost: 100, weaveCost: 3, effects: [{effectId: effect.damage, parameters: {damageType: fire, dice: {count: 1, sides: 6, bonus: 0}}, requiresLivingTarget: true}]}';
const compactBalance =
  '{kind: balance, startingCurrency: 40, id: balance.core, name: Core, tags: [core], readinessThreshold: 100, normalActionCost: 100, speedMinimum: 25, speedMaximum: 400, energyMinimum: -10000, energyMaximum: 10000, attributeMinimum: 0, attributeMaximum: 30, hungerMaximum: 10000, hungerThresholds: {hungry: 3000, weak: 1000, starving: 0}, starvationInterval: 500, starvationDamage: 1, recoveryInterval: 500, recoveryAmount: 1, weaveRegenAmount: 2, restMaximumDuration: 5000, recoveryByHungerStage: {sated: 100, hungry: 50, weak: 0, starving: 0}, hungerStageModifiers: {sated: {}, hungry: {}, weak: {}, starving: {}}, formulas: {health: {base: 8, vitality: 2}}, actionCosts: {action.move: 100}, score: {depthCoefficient: 100, bossDefeatCoefficient: 250, threatCoefficient: 5, discoveryCoefficient: 25, completionBonus: {died: 0, refused: 400, became-heart: 800, broke-cycle: 1500}, turnEfficiencyBudget: 500, turnEfficiencyDecayInterval: 200}, pointBuy: {budget: 1, costs: [{value: 0, cost: 0}, {value: 1, cost: 0}, {value: 2, cost: 0}, {value: 3, cost: 0}, {value: 4, cost: 0}, {value: 5, cost: 0}, {value: 6, cost: 0}, {value: 7, cost: 0}, {value: 8, cost: 0}, {value: 9, cost: 0}, {value: 10, cost: 0}, {value: 11, cost: 0}, {value: 12, cost: 0}, {value: 13, cost: 0}, {value: 14, cost: 0}, {value: 15, cost: 0}, {value: 16, cost: 0}, {value: 17, cost: 0}, {value: 18, cost: 0}, {value: 19, cost: 0}, {value: 20, cost: 0}, {value: 21, cost: 0}, {value: 22, cost: 0}, {value: 23, cost: 0}, {value: 24, cost: 0}, {value: 25, cost: 0}, {value: 26, cost: 0}, {value: 27, cost: 0}, {value: 28, cost: 0}, {value: 29, cost: 0}, {value: 30, cost: 0}]}, restockMilestones: [5, 10, 15, 20], house: {baseCapacity: 6, strongboxIncrement: 4}, encounterDensity: {cellsPerEncounter: 2000}}';

function scroll(spellId: string): string {
  return `{kind: item, id: item.test-scroll, name: Test scroll, glyph: "?", color: "#e37b46", tags: [scroll], minDepth: 1, maxDepth: 20, category: scroll, stackLimit: 3, price: 15, rarity: uncommon, actionCost: 100, spellId: ${spellId}, equipment: null, combat: null, light: null, identification: {mode: known, poolId: null}, effects: [{effectId: effect.item.consume, parameters: {quantity: 1}}]}`;
}

function contentFile(...entries: readonly string[]): string {
  return `schemaVersion: 7\nentries: [${entries.join(', ')}]\n`;
}

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'woven-content-spellid-'));
  for (const [path, source] of Object.entries(files)) {
    const target = join(root, path);
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, source);
  }
  return root;
}

describe('item spellId', () => {
  it('compiles when spellId resolves to a spell', async () => {
    const root = await fixture({
      'content.yaml': contentFile(
        compactMonster,
        compactVault,
        compactBalance,
        compactSpell,
        scroll('spell.test-bolt'),
      ),
    });
    const pack = await compileContentDirectory({ rootDir: root });
    const item = pack.entries.find((entry) => entry.id === 'item.test-scroll');
    expect(item).toMatchObject({ spellId: 'spell.test-bolt' });
  });

  it('reports an issue when spellId does not resolve to a spell', async () => {
    const root = await fixture({
      'content.yaml': contentFile(
        compactMonster,
        compactVault,
        compactBalance,
        compactSpell,
        scroll('spell.missing'),
      ),
    });
    await expect(compileContentDirectory({ rootDir: root })).rejects.toThrow(
      /unknown spell reference spell\.missing/i,
    );
  });
});
