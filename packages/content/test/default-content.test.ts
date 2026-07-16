import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateCompiledContentPack } from '../src/index.js';
import { compileContentDirectory } from '../src/compiler/index.js';

describe('bundled content', () => {
  it('contains every core gameplay kind and one balance entry', async () => {
    const pack = await compileContentDirectory({
      rootDir: resolve(import.meta.dirname, '../../../content'),
    });
    const kinds = ['monster', 'item', 'spell', 'trap', 'loot-table', 'balance', 'vault',
      'identification-pool', 'encounter', 'fallen-champion-template', 'npc', 'npc-faction',
      'achievement', 'class', 'background', 'trait'] as const;
    expect(Object.fromEntries(kinds.map((kind) => [kind,
      pack.entries.filter((entry) => entry.kind === kind).length]))).toEqual({
      monster: 4, item: 16, spell: 1, trap: 1, 'loot-table': 4, balance: 1, vault: 1,
      'identification-pool': 2, encounter: 5, 'fallen-champion-template': 1, npc: 1, 'npc-faction': 1,
      achievement: 2, class: 4, background: 3, trait: 5,
    });
    expect(pack.entries.filter((entry) => entry.kind === 'class' && (entry as any).playable)).toHaveLength(2);
    expect(pack.entries.filter((entry) => entry.kind === 'condition')).toHaveLength(5);
    expect(pack.entries.map((entry) => entry.id)).toEqual([...pack.entries.map((entry) => entry.id)].sort());
    expect(validateCompiledContentPack(JSON.parse(JSON.stringify(pack)))).toEqual(pack);
    expect(pack.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ships the exact Lampwright merchant contract', async () => {
    const pack = await compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
    const entries = new Map(pack.entries.map((entry) => [entry.id, entry]));
    expect(entries.get('balance.core-gameplay')).toMatchObject({ startingCurrency: 40 });
    expect(entries.get('npc-faction.lampwrights')).toMatchObject({
      minimumReputation: -1000, maximumReputation: 1000, startingReputation: 0,
      tiers: [
        { tierId: 'refused', minimum: -1000, maximum: -251, purchasePriceBps: 15000, salePriceBps: 5000, acceptsTrade: false, serviceIds: [] },
        { tierId: 'wary', minimum: -250, maximum: -1, purchasePriceBps: 13000, salePriceBps: 7000, acceptsTrade: true, serviceIds: [] },
        { tierId: 'neutral', minimum: 0, maximum: 249, purchasePriceBps: 11000, salePriceBps: 9000, acceptsTrade: true, serviceIds: ['merchant-service.identify'] },
        { tierId: 'trusted', minimum: 250, maximum: 1000, purchasePriceBps: 9000, salePriceBps: 10000, acceptsTrade: true, serviceIds: ['merchant-service.identify'] },
      ],
    });
    expect(entries.get('encounter.travelling-lampwright')).toMatchObject({
      model: 'merchant', minDepth: 1, maxDepth: 10, runAppearanceChance: 0.25,
      discoveryProtectionIncrement: 0, discoveryProtectionCap: 0, maximumInstancesPerRun: 2,
      definition: { minimumStockRolls: 1, maximumStockRolls: 2, merchantSaleBps: 12000,
        merchantPurchaseBps: 6000, minimumLifetime: 3000, maximumLifetime: 5000,
        departureWarningThresholds: [1000, 500, 100], aggressionResponse: 'flee',
        commerceReputationDelta: 25, aggressionReputationDelta: -300, deathReputationDelta: -200,
        stockDropFraction: 0.5 },
    });
  });

  it('ships schema-v6 run-record content: achievements, score coefficients, and monster threat', async () => {
    const pack = await compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
    expect(pack.schemaVersion).toBe(6);
    const entries = new Map(pack.entries.map((entry) => [entry.id, entry]));
    expect(entries.get('achievement.defeated-the-deeps-champion')).toMatchObject({
      kind: 'achievement', name: "Defeated the Deep's Champion", criteriaId: 'first-champion-defeat',
    });
    expect(entries.get('achievement.silenced-an-echo')).toMatchObject({
      kind: 'achievement', name: 'Silenced an Echo', criteriaId: 'first-echo-defeat',
    });
    expect(entries.get('balance.core-gameplay')).toMatchObject({
      score: {
        depthCoefficient: 100, bossDefeatCoefficient: 250, threatCoefficient: 5,
        discoveryCoefficient: 25,
        completionBonus: { died: 0, refused: 400, 'became-heart': 800, 'broke-cycle': 1500 },
        turnEfficiencyBudget: 500, turnEfficiencyDecayInterval: 200,
      },
      pointBuy: {
        budget: 30,
        costs: expect.arrayContaining([{ value: 0, cost: 0 }, { value: 30, cost: 60 }]),
      },
    });
    expect(entries.get('monster.cave-rat')).toMatchObject({ threat: 1 });
    expect(entries.get('monster.training-beetle')).toMatchObject({ threat: 2 });
    expect(entries.get('monster.rat-brood')).toMatchObject({ threat: 4 });
    expect(entries.get('monster.ashen-warden')).toMatchObject({ threat: 12 });
  });

  it('reports every foundational gameplay category', async () => {
    const pack = await compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
    expect(pack.generationReport.foundationalCategories)
      .toEqual(['defense', 'food', 'healing', 'identification', 'light', 'offense']);
  });

  it('ships coherent early loot, identification pools, and distinct light fuel models', async () => {
    const pack = await compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
    const entries = new Map(pack.entries.map((entry) => [entry.id, entry]));
    const loot = entries.get('loot-table.early-provisions');
    expect(loot?.kind).toBe('loot-table');
    if (loot?.kind !== 'loot-table') throw new Error('expected early provisions loot table');
    const accessibleTags = new Set(loot.choices.flatMap((choice) => {
      const entry = choice.contentId === null ? undefined : entries.get(choice.contentId);
      return entry?.kind === 'item' && choice.weight > 0 ? entry.tags : [];
    }));
    expect([...accessibleTags].filter((tag) => ['food', 'healing', 'light', 'offense', 'defense'].includes(tag)).sort())
      .toEqual(['defense', 'food', 'healing', 'light', 'offense']);

    const potions = ['item.ashen-potion', 'item.crimson-potion'].map((id) => entries.get(id));
    expect(potions.map((entry) => entry?.kind === 'item' ? entry.identification : null)).toEqual([
      { mode: 'shuffled', poolId: 'identification-pool.potions' },
      { mode: 'shuffled', poolId: 'identification-pool.potions' },
    ]);
    const potionPool = entries.get('identification-pool.potions');
    expect(potionPool?.kind === 'identification-pool'
      ? potionPool.verbs.length * potionPool.nouns.length : 0).toBeGreaterThan(2);
    const ring = entries.get('item.etched-ring');
    expect(ring?.kind === 'item' ? ring.identification.mode : null).toBe('instance');
    const lantern = entries.get('item.brass-lantern');
    const torch = entries.get('item.pitch-torch');
    expect(lantern?.kind === 'item' ? lantern.light?.fuelTags : null).toEqual(['lamp-oil']);
    expect(torch?.kind === 'item' ? torch.light?.fuelTags : null).toEqual([]);
  });

  it('revalidates condition references in a stored compiled pack', async () => {
    const pack = await compileContentDirectory({
      rootDir: resolve(import.meta.dirname, '../../../content'),
    });
    const corrupted = structuredClone(pack) as any;
    const lantern = corrupted.entries.find((entry: any) => entry.id === 'item.brass-lantern');
    lantern.effects = [{
      effectId: 'effect.condition.apply',
      parameters: { conditionId: 'condition.missing' },
      requiresLivingTarget: true,
    }];
    expect(() => validateCompiledContentPack(corrupted)).toThrow(/unknown condition reference condition\.missing/i);
  });
});
