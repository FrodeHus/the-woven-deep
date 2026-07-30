import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileContentDirectory } from '../src/compiler/index.js';

const compactMonster =
  '{kind: monster, id: monster.rat, name: Rat, glyph: r, color: "#aaaaaa", tags: [defense, food, healing, identification, light, offense], minDepth: 1, maxDepth: 5, attributes: {might: 3, agility: 8, vitality: 4, wits: 2, resolve: 2}, health: 4, speed: 110, accuracy: 1, defense: 10, perception: 6, damage: {count: 1, sides: 3, bonus: 0}, armor: 0, resistances: {physical: 0, fire: 0, cold: 0, lightning: 0, poison: 0, arcane: 0}, disposition: hostile, behaviorId: behavior.approach-and-attack, behaviorParameters: {}, threat: 2, rarity: common}';
const compactVault =
  '{kind: vault, id: vault.test-room, name: Test room, tags: [test], minDepth: 1, maxDepth: 5, rarity: common, weight: 10, maxPerFloor: 1, margin: 1, transforms: {rotations: [0, 180], reflectHorizontal: true}, layout: ["#####", "#+m.#", "#####"], legend: {"#": {terrain: wall}, ".": {terrain: floor}, "+": {terrain: floor, entrance: true}, m: {terrain: floor, slot: {id: monster-main, kind: monster, required: true, tags: [guard]}}}}';
const compactBalance =
  '{kind: balance, startingCurrency: 40, id: balance.core, name: Core, tags: [core], readinessThreshold: 100, normalActionCost: 100, speedMinimum: 25, speedMaximum: 400, energyMinimum: -10000, energyMaximum: 10000, attributeMinimum: 0, attributeMaximum: 30, hungerMaximum: 5000, hungerThresholds: {hungry: 1500, weak: 500, starving: 0}, starvationInterval: 500, starvationDamage: 1, recoveryInterval: 500, recoveryAmount: 1, weaveRegenAmount: 2, restMaximumDuration: 5000, recoveryByHungerStage: {sated: 100, hungry: 50, weak: 0, starving: 0}, hungerStageModifiers: {sated: {}, hungry: {}, weak: {}, starving: {}}, formulas: {health: {base: 8, vitality: 2}}, actionCosts: {action.move: 100}, score: {depthCoefficient: 100, bossDefeatCoefficient: 250, threatCoefficient: 5, discoveryCoefficient: 25, completionBonus: {died: 0, refused: 400, became-heart: 800, broke-cycle: 1500}, turnEfficiencyBudget: 500, turnEfficiencyDecayInterval: 200}, pointBuy: {budget: 1, costs: [{value: 0, cost: 0}, {value: 1, cost: 0}, {value: 2, cost: 0}, {value: 3, cost: 0}, {value: 4, cost: 0}, {value: 5, cost: 0}, {value: 6, cost: 0}, {value: 7, cost: 0}, {value: 8, cost: 0}, {value: 9, cost: 0}, {value: 10, cost: 0}, {value: 11, cost: 0}, {value: 12, cost: 0}, {value: 13, cost: 0}, {value: 14, cost: 0}, {value: 15, cost: 0}, {value: 16, cost: 0}, {value: 17, cost: 0}, {value: 18, cost: 0}, {value: 19, cost: 0}, {value: 20, cost: 0}, {value: 21, cost: 0}, {value: 22, cost: 0}, {value: 23, cost: 0}, {value: 24, cost: 0}, {value: 25, cost: 0}, {value: 26, cost: 0}, {value: 27, cost: 0}, {value: 28, cost: 0}, {value: 29, cost: 0}, {value: 30, cost: 0}]}, restockMilestones: [5, 10, 15, 20], house: {baseCapacity: 6, strongboxIncrement: 4}, encounterDensity: {openCellsPerEncounter: 2000}, fragmentSpawnRollDenominator: 40, generation: {doorTilePercent: 35, artifactOfferPercent: 12}, floorLoot: {scatterCount: {minimum: 2, maximum: 4}, chestCount: {minimum: 0, maximum: 2}, lockedChestPercent: 50, lockedDoorPercent: 15, minimumAnchorDistance: 8, minimumSpreadDistance: 6, depthBands: {shallowMaxDepth: 6, midMaxDepth: 13}, chestLockDifficulty: {shallow: 10, mid: 13, deep: 16}}}';
const compactSignatureSpell =
  '{kind: spell, id: spell.test-signature, name: Test signature, tags: [fire], targetingId: target.actor, range: 6, actionCost: 100, weaveCost: 3, effects: [{effectId: effect.damage, parameters: {damageType: fire, dice: {count: 1, sides: 6, bonus: 0}}, requiresLivingTarget: true}]}';

function contentFile(...entries: readonly string[]): string {
  return `schemaVersion: 10\nentries: [${entries.join(', ')}]\n`;
}

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'woven-content-artifact-validation-'));
  for (const [path, source] of Object.entries(files)) {
    const target = join(root, path);
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, source);
  }
  return root;
}

const DEFAULT_ARTIFACT =
  '{canon: true, signature: {spellId: spell.test-signature, charges: 3, rechargePerFloor: 1}, drawbackModifiers: {maxWeave: -10}, light: null}';

function artifactItem(overrides: {
  readonly rarity?: string;
  readonly stackLimit?: number;
  readonly identification?: string;
  readonly combat?: string;
  readonly artifact?: string;
}): string {
  const rarity = overrides.rarity ?? 'legendary';
  const stackLimit = overrides.stackLimit ?? 1;
  const identification = overrides.identification ?? '{mode: known, poolId: null}';
  const combat = overrides.combat ?? 'null';
  const artifact = overrides.artifact ?? DEFAULT_ARTIFACT;
  return `{kind: item, id: item.test-artifact, name: Test artifact, glyph: "!", color: "#e37b46", tags: [artifact], minDepth: 1, maxDepth: 20, category: misc, stackLimit: ${stackLimit}, price: 999, rarity: ${rarity}, actionCost: 100, equipment: null, combat: ${combat}, light: null, artifact: ${artifact}, identification: ${identification}, effects: []}`;
}

describe('artifact validation', () => {
  it('compiles an item with a valid artifact block', async () => {
    const root = await fixture({
      'content.yaml': contentFile(
        compactMonster,
        compactVault,
        compactBalance,
        compactSignatureSpell,
        artifactItem({}),
      ),
    });
    const compiled = await compileContentDirectory({ rootDir: root });
    const item = compiled.entries.find((entry) => entry.id === 'item.test-artifact');
    expect(item).toMatchObject({
      artifact: {
        canon: true,
        signature: { spellId: 'spell.test-signature', charges: 3, rechargePerFloor: 1 },
        drawbackModifiers: { maxWeave: -10 },
        light: null,
      },
    });
  });

  it('rejects an artifact item that is not rarity legendary', async () => {
    const root = await fixture({
      'content.yaml': contentFile(
        compactMonster,
        compactVault,
        compactBalance,
        compactSignatureSpell,
        artifactItem({ rarity: 'rare' }),
      ),
    });
    await expect(compileContentDirectory({ rootDir: root })).rejects.toThrow(/legendary/i);
  });

  it('rejects an artifact item with stackLimit other than 1', async () => {
    const root = await fixture({
      'content.yaml': contentFile(
        compactMonster,
        compactVault,
        compactBalance,
        compactSignatureSpell,
        artifactItem({ stackLimit: 2 }),
      ),
    });
    await expect(compileContentDirectory({ rootDir: root })).rejects.toThrow(/stackLimit/i);
  });

  it('rejects an artifact item whose identification mode is not known', async () => {
    const root = await fixture({
      'content.yaml': contentFile(
        compactMonster,
        compactVault,
        compactBalance,
        compactSignatureSpell,
        '{kind: identification-pool, id: identification-pool.test, name: Test pool, tags: [], category: misc, verbs: [Bubbling], nouns: [vial], visuals: [{id: visual.blue, glyph: "!", color: "#4466aa"}]}',
        artifactItem({
          identification: '{mode: shuffled, poolId: identification-pool.test}',
        }),
      ),
    });
    await expect(compileContentDirectory({ rootDir: root })).rejects.toThrow(
      /identification mode known/i,
    );
  });

  it('rejects an artifact item with no signature and no combat block', async () => {
    const root = await fixture({
      'content.yaml': contentFile(
        compactMonster,
        compactVault,
        compactBalance,
        compactSignatureSpell,
        artifactItem({
          artifact:
            '{canon: true, signature: null, drawbackModifiers: {maxWeave: -10}, light: null}',
        }),
      ),
    });
    await expect(compileContentDirectory({ rootDir: root })).rejects.toThrow(
      /signature spell, a combat block, or both/i,
    );
  });

  it('accepts an artifact item with only a combat block and no signature', async () => {
    const root = await fixture({
      'content.yaml': contentFile(
        compactMonster,
        compactVault,
        compactBalance,
        compactSignatureSpell,
        artifactItem({
          combat:
            '{accuracy: 1, defense: 0, armor: 0, damage: {count: 1, sides: 6, bonus: 0}, range: 1, ammunitionTag: null}',
          artifact:
            '{canon: true, signature: null, drawbackModifiers: {maxWeave: -10}, light: null}',
        }),
      ),
    });
    const compiled = await compileContentDirectory({ rootDir: root });
    expect(compiled.entries.find((entry) => entry.id === 'item.test-artifact')).toBeDefined();
  });

  it('rejects an artifact item with no drawback and no inextinguishable light', async () => {
    const root = await fixture({
      'content.yaml': contentFile(
        compactMonster,
        compactVault,
        compactBalance,
        compactSignatureSpell,
        artifactItem({
          artifact:
            '{canon: true, signature: {spellId: spell.test-signature, charges: 3, rechargePerFloor: 1}, drawbackModifiers: {}, light: null}',
        }),
      ),
    });
    await expect(compileContentDirectory({ rootDir: root })).rejects.toThrow(/drawback modifier/i);
  });

  it('rejects a positive value in drawbackModifiers', async () => {
    const root = await fixture({
      'content.yaml': contentFile(
        compactMonster,
        compactVault,
        compactBalance,
        compactSignatureSpell,
        artifactItem({
          artifact:
            '{canon: true, signature: {spellId: spell.test-signature, charges: 3, rechargePerFloor: 1}, drawbackModifiers: {maxWeave: 10}, light: null}',
        }),
      ),
    });
    await expect(compileContentDirectory({ rootDir: root })).rejects.toThrow(/negative/i);
  });

  it('rejects an unknown derived-stat key in drawbackModifiers', async () => {
    const root = await fixture({
      'content.yaml': contentFile(
        compactMonster,
        compactVault,
        compactBalance,
        compactSignatureSpell,
        artifactItem({
          artifact:
            '{canon: true, signature: {spellId: spell.test-signature, charges: 3, rechargePerFloor: 1}, drawbackModifiers: {notARealStat: -10}, light: null}',
        }),
      ),
    });
    await expect(compileContentDirectory({ rootDir: root })).rejects.toThrow(
      /unknown derived-stat key/i,
    );
  });

  it('rejects a signature spellId that does not resolve to a spell', async () => {
    const root = await fixture({
      'content.yaml': contentFile(
        compactMonster,
        compactVault,
        compactBalance,
        compactSignatureSpell,
        artifactItem({
          artifact:
            '{canon: true, signature: {spellId: spell.does-not-exist, charges: 3, rechargePerFloor: 1}, drawbackModifiers: {maxWeave: -10}, light: null}',
        }),
      ),
    });
    await expect(compileContentDirectory({ rootDir: root })).rejects.toThrow(
      /unknown spell reference/i,
    );
  });

  it('rejects artifact.light present while the item light block is null', async () => {
    const root = await fixture({
      'content.yaml': contentFile(
        compactMonster,
        compactVault,
        compactBalance,
        compactSignatureSpell,
        artifactItem({
          artifact:
            '{canon: true, signature: {spellId: spell.test-signature, charges: 3, rechargePerFloor: 1}, drawbackModifiers: {maxWeave: -10}, light: {fuelless: true, inextinguishable: true}}',
        }),
      ),
    });
    await expect(compileContentDirectory({ rootDir: root })).rejects.toThrow(
      /artifact light requires a non-null item light block/i,
    );
  });

  it('rejects an artifact contentId appearing in an ordinary loot-table choice', async () => {
    const lootTable =
      '{kind: loot-table, id: loot-table.test, name: Test table, tags: [], rolls: 1, choices: [{contentId: item.test-artifact, lootTableId: null, weight: 1, minimumQuantity: 1, maximumQuantity: 1}]}';
    const root = await fixture({
      'content.yaml': contentFile(
        compactMonster,
        compactVault,
        compactBalance,
        compactSignatureSpell,
        artifactItem({}),
        lootTable,
      ),
    });
    await expect(compileContentDirectory({ rootDir: root })).rejects.toThrow(
      /legendary artifact item\.test-artifact cannot appear in ordinary loot/i,
    );
  });
});
