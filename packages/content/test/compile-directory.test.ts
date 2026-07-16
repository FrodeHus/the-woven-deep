import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  compileContentDirectory,
  ContentCompileError,
  type ContentCompileIssue,
} from '../src/compiler/index.js';

const compactVault = '{kind: vault, id: vault.test-room, name: Test room, tags: [test], minDepth: 1, maxDepth: 5, rarity: common, weight: 10, maxPerFloor: 1, margin: 1, transforms: {rotations: [0, 180], reflectHorizontal: true}, layout: ["#####", "#+m.#", "#####"], legend: {"#": {terrain: wall}, ".": {terrain: floor}, "+": {terrain: floor, entrance: true}, m: {terrain: floor, slot: {id: monster-main, kind: monster, required: true, tags: [guard]}}}}';

const compactMonster = '{kind: monster, id: monster.rat, name: Rat, glyph: r, color: "#aaaaaa", tags: [defense, food, healing, identification, light, offense], minDepth: 1, maxDepth: 5, attributes: {might: 3, agility: 8, vitality: 4, wits: 2, resolve: 2}, health: 4, speed: 110, accuracy: 1, defense: 10, perception: 6, damage: {count: 1, sides: 3, bonus: 0}, armor: 0, resistances: {physical: 0, fire: 0, cold: 0, lightning: 0, poison: 0, arcane: 0}, disposition: hostile, behaviorId: behavior.approach-and-attack, behaviorParameters: {}, threat: 2, rarity: common}';
const compactItem = '{kind: item, id: item.lantern, name: Lantern, glyph: "¤", color: "#eeeeaa", tags: [defense, food, healing, identification, light, offense], minDepth: 1, maxDepth: 20, category: light, stackLimit: 1, price: 4, rarity: common, actionCost: 100, equipment: {slots: [off-hand], handedness: one-handed, reservedSlots: []}, combat: null, light: {color: [255, 200, 100], radius: 6, strength: 180, fuelCapacity: 1000, fuelPerTime: 1, warningThresholds: [100], fuelTags: [lamp-oil]}, identification: {mode: known, poolId: null}, effects: []}';
const compactBalance = '{kind: balance, startingCurrency: 40, id: balance.core, name: Core, tags: [core], readinessThreshold: 100, normalActionCost: 100, speedMinimum: 25, speedMaximum: 400, energyMinimum: -10000, energyMaximum: 10000, attributeMinimum: 0, attributeMaximum: 30, hungerMaximum: 10000, hungerThresholds: {hungry: 3000, weak: 1000, starving: 0}, starvationInterval: 500, starvationDamage: 1, recoveryInterval: 500, recoveryAmount: 1, restMaximumDuration: 5000, recoveryByHungerStage: {sated: 100, hungry: 50, weak: 0, starving: 0}, hungerStageModifiers: {sated: {}, hungry: {}, weak: {}, starving: {}}, formulas: {health: {base: 8, vitality: 2}}, actionCosts: {action.move: 100}, score: {depthCoefficient: 100, bossDefeatCoefficient: 250, threatCoefficient: 5, discoveryCoefficient: 25, completionBonus: {died: 0, refused: 400, became-heart: 800, broke-cycle: 1500}, turnEfficiencyBudget: 500, turnEfficiencyDecayInterval: 200}, pointBuy: {budget: 1, costs: [{value: 0, cost: 0}, {value: 1, cost: 0}, {value: 2, cost: 0}, {value: 3, cost: 0}, {value: 4, cost: 0}, {value: 5, cost: 0}, {value: 6, cost: 0}, {value: 7, cost: 0}, {value: 8, cost: 0}, {value: 9, cost: 0}, {value: 10, cost: 0}, {value: 11, cost: 0}, {value: 12, cost: 0}, {value: 13, cost: 0}, {value: 14, cost: 0}, {value: 15, cost: 0}, {value: 16, cost: 0}, {value: 17, cost: 0}, {value: 18, cost: 0}, {value: 19, cost: 0}, {value: 20, cost: 0}, {value: 21, cost: 0}, {value: 22, cost: 0}, {value: 23, cost: 0}, {value: 24, cost: 0}, {value: 25, cost: 0}, {value: 26, cost: 0}, {value: 27, cost: 0}, {value: 28, cost: 0}, {value: 29, cost: 0}, {value: 30, cost: 0}]}, restockMilestones: [5, 10, 15, 20], house: {baseCapacity: 6, strongboxIncrement: 4}, encounterDensity: {cellsPerEncounter: 2000}}';
const compactTimedCondition = '{kind: condition, id: condition.stunned, name: Stunned, description: Cannot act, tags: [control], color: "#d8c46a", duration: {mode: timed, default: 100, maximum: 500}, stacking: {mode: refresh, maximumStacks: 1}, modifiersPerStack: {defense: -2}, traits: [condition-trait.incapacitated]}';
const compactPermanentCondition = '{kind: condition, id: condition.warded, name: Warded, description: Remains until removed, tags: [beneficial], color: "#80b8ff", duration: {mode: permanent, default: null, maximum: null}, stacking: {mode: refresh, maximumStacks: 1}, modifiersPerStack: {}, traits: []}';
const compactIndividualEncounter = '{kind: encounter, id: encounter.rat, name: Rat encounter, tags: [], model: individual, minDepth: 1, maxDepth: 5, environmentTags: [], requiredVaultTags: [], weight: 1, rarity: common, runAppearanceChance: 1, discoveryProtectionIncrement: 0, discoveryProtectionCap: 1, maximumInstancesPerRun: 3, placement: {minimumStairDistance: 2, minimumObjectiveDistance: 2, maximumMemberDistance: 2, allowedTerrainTags: [floor], requiresVaultSlot: false, failureMode: optional}, intentPresentation: {visible: true}, definition: {monsterId: monster.rat, minimumQuantity: 1, maximumQuantity: 2}}';
const compactFaction = '{kind: npc-faction, id: npc-faction.lampwrights, name: Lampwrights, tags: [], minimumReputation: -100, maximumReputation: 100, startingReputation: 0, tiers: [{tierId: wary, name: Wary, minimum: -100, maximum: -1, purchasePriceBps: 12000, salePriceBps: 8000, acceptsTrade: true, serviceIds: []}, {tierId: neutral, name: Neutral, minimum: 0, maximum: 100, purchasePriceBps: 10000, salePriceBps: 10000, acceptsTrade: true, serviceIds: [merchant-service.identify]}]}';
const compactNpc = '{kind: npc, id: npc.lampwright, name: Lampwright, tags: [], glyph: L, color: "#ffd166", factionId: npc-faction.lampwrights, attributes: {might: 8, agility: 9, vitality: 10, wits: 12, resolve: 11}, health: 20, speed: 100, perception: 12, accuracy: 8, defense: 10, damage: {count: 1, sides: 4, bonus: 0}, armor: 1, resistances: {physical: 0, fire: 0, cold: 0, lightning: 0, poison: 0, arcane: 0}, disposition: neutral, behaviorId: npc-behavior.travelling-merchant, behaviorParameters: {}, selfPreservationThresholdBps: 3500}';
const compactStock = '{kind: loot-table, id: loot-table.stock, name: Stock, tags: [], rolls: 1, choices: [{contentId: item.lantern, lootTableId: null, weight: 1, minimumQuantity: 1, maximumQuantity: 1}]}';
const compactMerchant = '{kind: encounter, id: encounter.merchant, name: Merchant, tags: [], model: merchant, minDepth: 1, maxDepth: 10, environmentTags: [], requiredVaultTags: [], weight: 1, rarity: uncommon, runAppearanceChance: 0.25, maximumInstancesPerRun: 2, placement: {minimumStairDistance: 3, minimumObjectiveDistance: 3, maximumMemberDistance: 0, allowedTerrainTags: [floor], requiresVaultSlot: false, failureMode: optional}, intentPresentation: {visible: true}, definition: {npcId: npc.lampwright, stockLootTableId: loot-table.stock, minimumStockRolls: 1, maximumStockRolls: 2, merchantSaleBps: 12000, merchantPurchaseBps: 6000, acceptedCategories: [light], services: [{serviceId: merchant-service.identify, basePrice: 10, minimumUses: 1, maximumUses: 2, tierIds: [neutral]}], permanent: false, minimumLifetime: 3000, maximumLifetime: 5000, departureWarningThresholds: [1000, 500, 100], aggressionResponse: flee, commerceReputationDelta: 25, aggressionReputationDelta: -300, deathReputationDelta: -200, stockDropFraction: 0.5}}';

function achievement(id: string, criteriaId: string): string {
  return `{kind: achievement, id: ${id}, name: Achievement, tags: [], description: Do the thing first., criteriaId: ${criteriaId}}`;
}

function playableClass(kitCount: 1 | 2, equippedSlot = 'off-hand'): string {
  const kit1 = `{kitId: first, name: First, equipped: [{contentId: item.lantern, slot: ${equippedSlot}, enabled: true}], backpack: []}`;
  const kit2 = '{kitId: second, name: Second, equipped: [], backpack: []}';
  const kits = kitCount === 1 ? kit1 : `${kit1}, ${kit2}`;
  return `{kind: class, id: class.wayfarer, name: Wayfarer, tags: [], description: A traveller., playable: true, silhouetteGlyph: W, unlockHint: null, classTags: [wayfarer], kits: [${kits}]}`;
}

function backgroundEntry(extraItemContentId: string | null): string {
  const extraItems = extraItemContentId === null ? '[]' : `[{contentId: ${extraItemContentId}, quantity: 1}]`;
  return `{kind: background, id: background.caravan-guard, name: Caravan guard, tags: [], description: Wards caravans., modifiers: {defense: 1}, extraItems: ${extraItems}}`;
}

function contentFile(...entries: readonly string[]): string {
  return `schemaVersion: 7\nentries: [${entries.join(', ')}]\n`;
}

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'woven-content-'));
  const completeFiles = { 'balance.yaml': contentFile(compactBalance), ...files };
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

describe('compileContentDirectory', () => {
  it('compiles merchant content and materializes discovery protection as zero', async () => {
    const root = await fixture({ 'content.yaml': contentFile(compactMonster, compactItem, compactVault,
      compactFaction, compactNpc, compactStock, compactMerchant) });
    const pack = await compileContentDirectory({ rootDir: root });
    expect(pack.entries.find((entry) => entry.id === 'encounter.merchant')).toMatchObject({
      model: 'merchant', discoveryProtectionIncrement: 0, discoveryProtectionCap: 0,
    });
  });

  it('allows zero-priced services and zero-use offers', async () => {
    const zeroService = compactMerchant
      .replace('basePrice: 10', 'basePrice: 0')
      .replace('minimumUses: 1, maximumUses: 2', 'minimumUses: 0, maximumUses: 0');
    const root = await fixture({ 'content.yaml': contentFile(compactMonster, compactItem, compactVault,
      compactFaction, compactNpc, compactStock, zeroService) });
    await expect(compileContentDirectory({ rootDir: root })).resolves.toBeDefined();
  });

  it('requires nonmerchant discovery protection fields while defaulting them for merchants', async () => {
    const root = await fixture({ 'content.yaml': contentFile(compactMonster, compactItem, compactVault,
      compactIndividualEncounter.replace(', discoveryProtectionIncrement: 0, discoveryProtectionCap: 1', '')) });
    await expect(compileContentDirectory({ rootDir: root })).rejects.toThrow(/expected number/i);
  });

  it('requires a merchant service to be enabled by every targeted faction tier', async () => {
    const waryService = compactMerchant.replace('tierIds: [neutral]', 'tierIds: [wary]');
    const root = await fixture({ 'content.yaml': contentFile(compactMonster, compactItem, compactVault,
      compactFaction, compactNpc, compactStock, waryService) });
    await expect(compileContentDirectory({ rootDir: root })).rejects
      .toThrow(/service merchant-service\.identify is not enabled for faction tier wary/);
  });

  it('preserves authored tier indices in overlap diagnostics', async () => {
    const reversedOverlap = compactFaction.replace(
      'tiers: [{tierId: wary, name: Wary, minimum: -100, maximum: -1, purchasePriceBps: 12000, salePriceBps: 8000, acceptsTrade: true, serviceIds: []}, {tierId: neutral, name: Neutral, minimum: 0, maximum: 100, purchasePriceBps: 10000, salePriceBps: 10000, acceptsTrade: true, serviceIds: [merchant-service.identify]}]',
      'tiers: [{tierId: neutral, name: Neutral, minimum: 0, maximum: 100, purchasePriceBps: 10000, salePriceBps: 10000, acceptsTrade: true, serviceIds: [merchant-service.identify]}, {tierId: wary, name: Wary, minimum: -100, maximum: 0, purchasePriceBps: 12000, salePriceBps: 8000, acceptsTrade: true, serviceIds: []}]',
    );
    const root = await fixture({ 'content.yaml': contentFile(compactMonster, compactItem, compactVault,
      reversedOverlap, compactNpc, compactStock, compactMerchant) });
    await expectCompileIssues(compileContentDirectory({ rootDir: root }), [{
      file: 'content.yaml', path: '$.entries.npc-faction.lampwrights.tiers.0',
      message: 'reputation tiers must cover every value without gaps or overlaps',
    }]);
  });

  it.each([
    ['duplicate tier ID', compactFaction.replace('tierId: neutral', 'tierId: wary'), /duplicate reputation tier wary/],
    ['duplicate faction service ID', compactFaction.replace('serviceIds: \[merchant-service.identify\]', 'serviceIds: [merchant-service.identify, merchant-service.identify]'), /duplicate service ID/],
    ['zero faction multiplier', compactFaction.replace('purchasePriceBps: 12000', 'purchasePriceBps: 0'), /purchasePriceBps/],
    ['negative merchant multiplier', compactMerchant.replace('merchantSaleBps: 12000', 'merchantSaleBps: -1'), /merchantSaleBps/],
    ['duplicate warning', compactMerchant.replace('[1000, 500, 100]', '[1000, 1000, 100]'), /warning thresholds must be unique/],
    ['out-of-range warning', compactMerchant.replace('[1000, 500, 100]', '[3000, 500, 100]'), /below minimum lifetime/],
    ['stock inversion', compactMerchant.replace('minimumStockRolls: 1, maximumStockRolls: 2', 'minimumStockRolls: 3, maximumStockRolls: 2'), /maximum stock rolls/],
    ['lifetime inversion', compactMerchant.replace('minimumLifetime: 3000, maximumLifetime: 5000', 'minimumLifetime: 6000, maximumLifetime: 5000'), /maximum lifetime/],
  ])('rejects complete merchant semantic matrix case: %s', async (_label, replacement, diagnostic) => {
    const root = await fixture({ 'content.yaml': contentFile(compactMonster, compactItem, compactVault,
      replacement.includes('kind: npc-faction') ? replacement : compactFaction,
      compactNpc, compactStock, replacement.includes('model: merchant') ? replacement : compactMerchant) });
    await expect(compileContentDirectory({ rootDir: root })).rejects.toThrow(diagnostic);
  });

  it('rejects duplicate merchant service offer IDs', async () => {
    const duplicateService = compactMerchant.replace('services: [',
      'services: [{serviceId: merchant-service.identify, basePrice: 0, minimumUses: 0, maximumUses: 0, tierIds: [neutral]}, ');
    const root = await fixture({ 'content.yaml': contentFile(compactMonster, compactItem, compactVault,
      compactFaction, compactNpc, compactStock, duplicateService) });
    await expect(compileContentDirectory({ rootDir: root })).rejects
      .toThrow(/duplicate merchant service merchant-service\.identify/);
  });

  it('walks nested merchant stock tables before accepting the pack', async () => {
    const nested = '{kind: loot-table, id: loot-table.nested-stock, name: Nested, tags: [], rolls: 1, choices: [{contentId: item.lantern, lootTableId: null, weight: 1, minimumQuantity: 1, maximumQuantity: 1}]}';
    const parent = compactStock.replace('contentId: item.lantern, lootTableId: null', 'contentId: null, lootTableId: loot-table.nested-stock');
    const root = await fixture({ 'content.yaml': contentFile(compactMonster,
      compactItem.replace('price: 4', 'price: 0'), compactVault, compactFaction, compactNpc, parent, nested, compactMerchant) });
    await expect(compileContentDirectory({ rootDir: root })).rejects
      .toThrow(/merchant stock item item\.lantern requires positive price/);
  });

  it('rejects a boss-unique item reachable from merchant stock', async () => {
    const ordinary = compactItem.replace('item.lantern', 'item.ordinary').replace('name: Lantern', 'name: Ordinary');
    const bossLoot = '{kind: loot-table, id: loot-table.boss, name: Boss, tags: [], rolls: 1, choices: [{contentId: item.ordinary, lootTableId: null, weight: 1, minimumQuantity: 1, maximumQuantity: 1}]}';
    const boss = '{kind: encounter, id: encounter.boss, name: Boss, tags: [], model: boss, minDepth: 1, maxDepth: 5, environmentTags: [], requiredVaultTags: [], weight: 1, rarity: legendary, runAppearanceChance: 1, discoveryProtectionIncrement: 0, discoveryProtectionCap: 1, maximumInstancesPerRun: 1, placement: {minimumStairDistance: 2, minimumObjectiveDistance: 2, maximumMemberDistance: 0, allowedTerrainTags: [floor], requiresVaultSlot: false, failureMode: optional}, intentPresentation: {visible: true}, definition: {monsterId: monster.rat, phases: [], recoveryPerWorldTime: 0, recoveryCapPercent: 0, uniqueItemId: item.lantern, enhancedLootTableId: loot-table.boss, vaultTags: []}}';
    const root = await fixture({ 'content.yaml': contentFile(compactMonster, compactItem, ordinary, compactVault,
      compactFaction, compactNpc, compactStock, bossLoot, compactMerchant, boss) });
    await expect(compileContentDirectory({ rootDir: root })).rejects
      .toThrow(/merchant stock item item\.lantern is guaranteed unique/);
  });

  it.each(['heirloom', 'quest', 'objective', 'nontransferable'])
    ('rejects merchant stock tagged %s', async (tag) => {
      const item = compactItem.replace('tags: [defense, food, healing, identification, light, offense]', `tags: [${tag}]`);
      const root = await fixture({ 'content.yaml': contentFile(compactMonster, item, compactVault,
        compactFaction, compactNpc, compactStock, compactMerchant) });
      await expect(compileContentDirectory({ rootDir: root })).rejects.toThrow(new RegExp(`reserved ${tag} tag`));
    });

  it.each([
    ['missing faction', compactNpc.replace('npc-faction.lampwrights', 'npc-faction.missing'), /unknown npc-faction reference/],
    ['faction gap', compactFaction.replace('minimum: 0, maximum: 100', 'minimum: 1, maximum: 100'), /reputation tiers must cover every value/],
    ['starting reputation outside bounds', compactFaction.replace('startingReputation: 0', 'startingReputation: 101'), /starting reputation must be within faction bounds/],
    ['missing NPC', compactMerchant.replace('npc.lampwright', 'npc.missing'), /unknown npc reference/],
    ['missing stock', compactMerchant.replace('loot-table.stock', 'loot-table.missing'), /unknown loot-table reference/],
    ['warning order', compactMerchant.replace('[1000, 500, 100]', '[500, 1000, 100]'), /warning thresholds must be unique/],
    ['service uses', compactMerchant.replace('minimumUses: 1, maximumUses: 2', 'minimumUses: 2, maximumUses: 1'), /maximum service uses/],
    ['unknown service tier', compactMerchant.replace('tierIds: [neutral]', 'tierIds: [trusted]'), /absent from NPC faction/],
  ])('rejects merchant semantic error: %s', async (_label, replacement, message) => {
    const entries = [compactMonster, compactItem, compactVault,
      replacement.includes('kind: npc-faction') ? replacement : compactFaction,
      replacement.includes('kind: npc,') ? replacement : compactNpc,
      compactStock,
      replacement.includes('model: merchant') ? replacement : compactMerchant];
    const root = await fixture({ 'content.yaml': contentFile(...entries) });
    await expect(compileContentDirectory({ rootDir: root })).rejects.toThrow(message);
  });

  it('rejects merchant stock with a zero price or reserved tag', async () => {
    for (const item of [compactItem.replace('price: 4', 'price: 0'), compactItem.replace('tags: [defense, food, healing, identification, light, offense]', 'tags: [quest]')]) {
      const root = await fixture({ 'content.yaml': contentFile(compactMonster, item, compactVault,
        compactFaction, compactNpc, compactStock, compactMerchant) });
      await expect(compileContentDirectory({ rootDir: root })).rejects.toThrow(/positive price|reserved quest tag/);
    }
  });
  it('compiles achievements and allows at most one achievement per criterion', async () => {
    const validRoot = await fixture({ 'content.yaml': contentFile(compactMonster, compactItem, compactVault,
      achievement('achievement.a', 'first-champion-defeat'),
      achievement('achievement.b', 'first-echo-defeat')) });
    const pack = await compileContentDirectory({ rootDir: validRoot });
    expect(pack.entries.filter((entry) => entry.kind === 'achievement')).toHaveLength(2);

    const duplicateRoot = await fixture({ 'content.yaml': contentFile(compactMonster, compactItem, compactVault,
      achievement('achievement.a', 'first-champion-defeat'),
      achievement('achievement.b', 'first-champion-defeat')) });
    await expect(compileContentDirectory({ rootDir: duplicateRoot })).rejects
      .toThrow(/at most one achievement per criterion/);
  });

  it('compiles a playable class whose kits reference real items in allowed slots', async () => {
    const root = await fixture({ 'content.yaml': contentFile(compactMonster, compactItem, compactVault,
      playableClass(2)) });
    const pack = await compileContentDirectory({ rootDir: root });
    expect(pack.entries.filter((entry) => entry.kind === 'class')).toHaveLength(1);
  });

  it('rejects a playable class with only one kit', async () => {
    const root = await fixture({ 'content.yaml': contentFile(compactMonster, compactItem, compactVault,
      playableClass(1)) });
    await expect(compileContentDirectory({ rootDir: root })).rejects
      .toThrow(/at least 2 kits/);
  });

  it('rejects a class kit that sets enabled on a non-light equipped item', async () => {
    const sword = compactItem
      .replace('item.lantern', 'item.sword').replace('name: Lantern', 'name: Sword')
      .replace('category: light', 'category: weapon')
      .replace('equipment: {slots: [off-hand], handedness: one-handed, reservedSlots: []}',
        'equipment: {slots: [main-hand], handedness: one-handed, reservedSlots: []}')
      .replace('light: {color: [255, 200, 100], radius: 6, strength: 180, fuelCapacity: 1000, fuelPerTime: 1, warningThresholds: [100], fuelTags: [lamp-oil]}', 'light: null');
    const kit1 = '{kitId: first, name: First, equipped: '
      + '[{contentId: item.sword, slot: main-hand, enabled: true}], backpack: []}';
    const kit2 = '{kitId: second, name: Second, equipped: [], backpack: []}';
    const enabledOnNonLightClass = `{kind: class, id: class.wayfarer, name: Wayfarer, tags: [], description: A traveller., playable: true, silhouetteGlyph: W, unlockHint: null, classTags: [wayfarer], kits: [${kit1}, ${kit2}]}`;
    const root = await fixture({ 'content.yaml': contentFile(compactMonster, compactItem, sword, compactVault,
      enabledOnNonLightClass) });
    await expect(compileContentDirectory({ rootDir: root })).rejects
      .toThrow(/kit first sets enabled on non-light item item\.sword/);
  });

  it('rejects a class kit that equips a missing item', async () => {
    const missingItemClass = playableClass(2).replace('item.lantern', 'item.missing');
    const root = await fixture({ 'content.yaml': contentFile(compactMonster, compactItem, compactVault,
      missingItemClass) });
    await expect(compileContentDirectory({ rootDir: root })).rejects
      .toThrow(/unknown item reference item\.missing/);
  });

  it('rejects a class kit that equips an item in a slot it does not allow', async () => {
    const root = await fixture({ 'content.yaml': contentFile(compactMonster, compactItem, compactVault,
      playableClass(2, 'main-hand')) });
    await expect(compileContentDirectory({ rootDir: root })).rejects
      .toThrow(/cannot be equipped in slot main-hand/);
  });

  it('rejects a class kit that equips a two-handed item alongside something in its reserved slot', async () => {
    const twoHandedBow = compactItem
      .replace('item.lantern', 'item.bow').replace('name: Lantern', 'name: Bow')
      .replace('equipment: {slots: [off-hand], handedness: one-handed, reservedSlots: []}',
        'equipment: {slots: [main-hand], handedness: two-handed, reservedSlots: [off-hand]}');
    const conflictingKit = '{kitId: first, name: First, equipped: '
      + '[{contentId: item.bow, slot: main-hand, enabled: true}, {contentId: item.lantern, slot: off-hand, enabled: true}], backpack: []}';
    const secondKit = '{kitId: second, name: Second, equipped: [], backpack: []}';
    const conflictingClass = `{kind: class, id: class.wayfarer, name: Wayfarer, tags: [], description: A traveller., playable: true, silhouetteGlyph: W, unlockHint: null, classTags: [wayfarer], kits: [${conflictingKit}, ${secondKit}]}`;
    const root = await fixture({ 'content.yaml': contentFile(compactMonster, compactItem, twoHandedBow, compactVault,
      conflictingClass) });
    await expect(compileContentDirectory({ rootDir: root })).rejects
      .toThrow(/kit first.*reserved slot off-hand/i);
  });

  it('rejects a background whose extraItems reference a missing item', async () => {
    const root = await fixture({ 'content.yaml': contentFile(compactMonster, compactItem, compactVault,
      backgroundEntry('item.missing')) });
    await expect(compileContentDirectory({ rootDir: root })).rejects
      .toThrow(/unknown item reference item\.missing/);
  });

  it('compiles a background whose extraItems reference a real item', async () => {
    const root = await fixture({ 'content.yaml': contentFile(compactMonster, compactItem, compactVault,
      backgroundEntry('item.lantern')) });
    const pack = await compileContentDirectory({ rootDir: root });
    expect(pack.entries.filter((entry) => entry.kind === 'background')).toHaveLength(1);
  });

  it('produces the same hash regardless of YAML formatting and filenames', async () => {
    const compact = await fixture({
      'z.yaml': contentFile(compactMonster, compactItem, compactVault),
    });
    const expanded = await fixture({
      'nested/a.yml': contentFile(compactMonster, compactItem),
      'vaults/test.yaml': contentFile(compactVault),
    });

    const left = await compileContentDirectory({ rootDir: compact });
    const right = await compileContentDirectory({ rootDir: expanded });
    expect(left.hash).toBe(right.hash);
    expect(left.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects duplicate IDs in code-unit path order', async () => {
    const root = await fixture({
      'z.yaml': contentFile(compactMonster, compactItem, compactVault),
      'ä.yaml': contentFile(compactMonster.replace('name: Rat', 'name: Rat Two').replace('health: 4', 'health: 5')),
    });

    await expectCompileIssues(
      compileContentDirectory({ rootDir: root }),
      [{
        file: 'ä.yaml',
        path: '$.entries.id',
        message: 'duplicate monster.rat; first declared in z.yaml',
      }],
    );
  });

  it('rejects an unregistered behavior reference', async () => {
    const root = await fixture({
      'content.yaml': contentFile(
        compactMonster.replace('behavior.approach-and-attack', 'behavior.unknown'),
        compactItem,
        compactVault,
      ),
    });

    await expectCompileIssues(
      compileContentDirectory({ rootDir: root }),
      [{
        file: 'content.yaml',
        path: '$.entries.monster.rat.behavior',
        message: 'unregistered behavior behavior.unknown',
      }],
    );
  });

  it('accepts registered patrol waypoints and rejects an empty patrol', async () => {
    const patrol = compactMonster
      .replace('behavior.approach-and-attack', 'behavior.patrol')
      .replace('behaviorParameters: {}', 'behaviorParameters: {waypoints: [{x: 1, y: 2}, {x: 3, y: 4}]}');
    const validRoot = await fixture({ 'content.yaml': contentFile(patrol, compactItem, compactVault) });
    await expect(compileContentDirectory({ rootDir: validRoot })).resolves.toBeDefined();

    const invalidRoot = await fixture({
      'content.yaml': contentFile(patrol.replace('waypoints: [{x: 1, y: 2}, {x: 3, y: 4}]', 'waypoints: []'),
        compactItem, compactVault),
    });
    await expect(compileContentDirectory({ rootDir: invalidRoot })).rejects.toThrow(/waypoints|too small/i);
  });

  it('rejects inconsistent equipment handedness', async () => {
    const invalidItem = compactItem
      .replace('slots: [off-hand]', 'slots: [head]')
      .replace('handedness: one-handed', 'handedness: two-handed');
    const root = await fixture({ 'content.yaml': contentFile(compactMonster, invalidItem, compactVault) });

    await expect(compileContentDirectory({ rootDir: root })).rejects.toThrow(/two-handed equipment must use the main-hand slot/i);
  });

  it('rejects unregistered effects and invalid registered effect parameters', async () => {
    const unknownEffect = compactItem.replace(
      'effects: []',
      'effects: [{effectId: effect.unknown, parameters: {}, requiresLivingTarget: false}, {effectId: effect.heal, parameters: {dice: {count: 0, sides: 4, bonus: 0}}, requiresLivingTarget: false}]',
    );
    const root = await fixture({ 'content.yaml': contentFile(compactMonster, unknownEffect, compactVault) });

    await expect(compileContentDirectory({ rootDir: root })).rejects.toThrow(/unregistered effect effect\.unknown|expected number to be >0/i);
  });

  it.each([
    ['missing condition', 'condition.missing', '', /unknown condition reference condition\.missing/],
    ['wrong content kind', 'item.lantern', '', /condition reference item\.lantern resolves to item/],
    ['duration above maximum', 'condition.stunned', ', duration: 501', /duration 501 exceeds maximum 500/],
  ])('rejects %s', async (_label, conditionId, duration, message) => {
    const effect = `[{effectId: effect.condition.apply, parameters: {conditionId: ${conditionId}${duration}}, requiresLivingTarget: true}]`;
    const item = compactItem.replace('effects: []', `effects: ${effect}`);
    const root = await fixture({
      'content.yaml': contentFile(compactMonster, item, compactVault, compactTimedCondition),
    });
    await expect(compileContentDirectory({ rootDir: root })).rejects.toThrow(message);
  });

  it('accepts omitted timed and permanent durations but rejects a permanent override with an exact path', async () => {
    const omitted = compactItem.replace('effects: []', 'effects: [{effectId: effect.condition.apply, parameters: {conditionId: condition.warded}, requiresLivingTarget: true}]');
    const validRoot = await fixture({
      'content.yaml': contentFile(compactMonster, omitted, compactVault, compactPermanentCondition),
    });
    await expect(compileContentDirectory({ rootDir: validRoot })).resolves.toBeDefined();

    const overridden = omitted.replace('condition.warded}', 'condition.warded, duration: 1}');
    const invalidRoot = await fixture({
      'content.yaml': contentFile(compactMonster, overridden, compactVault, compactPermanentCondition),
    });
    await expectCompileIssues(compileContentDirectory({ rootDir: invalidRoot }), [{
      file: 'content.yaml',
      path: '$.entries.item.lantern.effects.0.parameters.duration',
      message: 'permanent condition rejects a duration override',
    }]);
  });

  it('rejects nested loot-table cycles', async () => {
    const first = '{kind: loot-table, id: loot-table.first, name: First, tags: [], rolls: 1, choices: [{contentId: null, lootTableId: loot-table.second, weight: 1, minimumQuantity: 1, maximumQuantity: 1}]}';
    const second = '{kind: loot-table, id: loot-table.second, name: Second, tags: [], rolls: 1, choices: [{contentId: null, lootTableId: loot-table.first, weight: 1, minimumQuantity: 1, maximumQuantity: 1}]}';
    const root = await fixture({ 'content.yaml': contentFile(compactMonster, compactItem, compactVault, first, second) });

    await expect(compileContentDirectory({ rootDir: root })).rejects.toThrow(/loot-table cycle detected/i);
  });

  it('bounds checked loot weights, rolls, quantities, and recursive worst-case units', async () => {
    const boundedItem = compactItem.replace('stackLimit: 1', 'stackLimit: 256');
    const table = (id: string, rolls: number, secondWeight: number, quantity: number, nested: string | null = null) =>
      `{kind: loot-table, id: ${id}, name: Bounded loot, tags: [], rolls: ${rolls}, choices: [{contentId: ${nested === null ? 'item.lantern' : 'null'}, lootTableId: ${nested ?? 'null'}, weight: 2147483648, minimumQuantity: ${quantity}, maximumQuantity: ${quantity}}, {contentId: item.lantern, lootTableId: null, weight: ${secondWeight}, minimumQuantity: 1, maximumQuantity: 1}]}`;
    const boundary = await fixture({ 'content.yaml': contentFile(compactMonster, boundedItem, compactVault,
      table('loot-table.boundary', 16, 2147483648, 256),
      table('loot-table.roll-boundary', 256, 1, 16)) });
    await expect(compileContentDirectory({ rootDir: boundary })).resolves.toBeDefined();

    for (const invalid of [
      table('loot-table.weight', 1, 2147483649, 1),
      table('loot-table.rolls', 257, 1, 1),
      table('loot-table.quantity', 1, 1, 257),
    ]) {
      const root = await fixture({ 'content.yaml': contentFile(compactMonster, boundedItem, compactVault, invalid) });
      await expect(compileContentDirectory({ rootDir: root })).rejects.toThrow(/loot.*(weight.*2\^32|rolls.*256|quantity.*256)/i);
    }

    const child = table('loot-table.child', 16, 1, 16);
    const nestedBoundary = table('loot-table.parent', 16, 1, 1, 'loot-table.child');
    const nested = await fixture({ 'content.yaml': contentFile(compactMonster, boundedItem, compactVault,
      child, nestedBoundary) });
    await expect(compileContentDirectory({ rootDir: nested })).resolves.toBeDefined();
    const excessive = await fixture({ 'content.yaml': contentFile(compactMonster, boundedItem, compactVault,
      child, nestedBoundary.replace('minimumQuantity: 1, maximumQuantity: 1', 'minimumQuantity: 2, maximumQuantity: 2')) });
    await expect(compileContentDirectory({ rootDir: excessive })).rejects.toThrow(/loot.*worst-case.*4096/i);
  });

  it('requires exactly one balance entry', async () => {
    const root = await fixture({
      'content.yaml': contentFile(compactMonster, compactItem, compactVault, compactBalance.replace('balance.core', 'balance.alternate')),
    });

    await expect(compileContentDirectory({ rootDir: root })).rejects.toThrow(/expected exactly one balance entry; found 2/i);
  });

  it('requires a positive rest maximum duration', async () => {
    const root = await fixture({
      'balance.yaml': contentFile(compactBalance.replace('restMaximumDuration: 5000', 'restMaximumDuration: 0')),
    });
    await expect(compileContentDirectory({ rootDir: root })).rejects.toThrow(/restMaximumDuration/i);
  });

  it('rejects a pack missing any foundational gameplay category', async () => {
    const root = await fixture({
      'content.yaml': contentFile(compactMonster.replace('identification, ', ''),
        compactItem.replace('identification, ', ''), compactVault),
    });
    await expect(compileContentDirectory({ rootDir: root })).rejects.toThrow(/missing foundational category identification/i);
  });

  it('loads unidentified presentation from a separate pool instead of item definitions', async () => {
    const potion = (id: string) => compactItem.replace('item.lantern', id)
      .replace('category: light', 'category: potion')
      .replace('equipment: {slots: [off-hand], handedness: one-handed, reservedSlots: []}', 'equipment: null')
      .replace(/light: \{[^}]+\}/, 'light: null')
      .replace('identification: {mode: known, poolId: null}',
        'identification: {mode: shuffled, poolId: identification-pool.potions}');
    const pool = '{kind: identification-pool, id: identification-pool.potions, name: Potion appearances, tags: [], category: potion, verbs: [Clouded, Smoking, Whispering], nouns: [vial, flask, phial], visuals: [{id: visual.teal-glass, glyph: "!", color: "#4faaa2"}, {id: visual.amber-glass, glyph: "¡", color: "#c58745"}]}';
    const root = await fixture({ 'content.yaml': contentFile(compactMonster, compactVault, pool,
      potion('item.potion-one'), potion('item.potion-two')) });
    const compiled = await compileContentDirectory({ rootDir: root });
    const item = compiled.entries.find((entry) => entry.id === 'item.potion-one');
    expect(item).toMatchObject({
      name: 'Lantern',
      identification: { mode: 'shuffled', poolId: 'identification-pool.potions' },
    });
    expect(item).not.toHaveProperty('identification.appearances');
  });

  it('requires enough unique verb-noun names for every item using a pool', async () => {
    const potion = (id: string) => compactItem.replace('item.lantern', id)
      .replace('category: light', 'category: potion')
      .replace('equipment: {slots: [off-hand], handedness: one-handed, reservedSlots: []}', 'equipment: null')
      .replace(/light: \{[^}]+\}/, 'light: null')
      .replace('identification: {mode: known, poolId: null}',
        'identification: {mode: shuffled, poolId: identification-pool.potions}');
    const pool = '{kind: identification-pool, id: identification-pool.potions, name: Potion names, tags: [], category: potion, verbs: [Bubbling], nouns: [vial], visuals: [{id: visual.blue-glass, glyph: "!", color: "#4466aa"}]}';
    const root = await fixture({ 'content.yaml': contentFile(compactMonster, compactVault, pool,
      potion('item.potion-one'), potion('item.potion-two')) });
    await expect(compileContentDirectory({ rootDir: root })).rejects.toThrow(
      /identification pool identification-pool\.potions can create 1 unique names for 2 items/i,
    );
  });

  it('requires direct loot choices to reference items', async () => {
    const table = '{kind: loot-table, id: loot-table.invalid, name: Invalid, tags: [], rolls: 1, choices: [{contentId: monster.rat, lootTableId: null, weight: 1, minimumQuantity: 1, maximumQuantity: 1}]}';
    const root = await fixture({ 'content.yaml': contentFile(compactMonster, compactItem, compactVault, table) });
    await expect(compileContentDirectory({ rootDir: root })).rejects.toThrow(/content reference monster\.rat resolves to monster; expected item/i);
  });

  it('requires ranged weapon ammunition tags to have matching ammunition', async () => {
    const weapon = compactItem.replace('item.lantern', 'item.bow')
      .replace('category: light', 'category: weapon')
      .replace('light: {color: [255, 200, 100], radius: 6, strength: 180, fuelCapacity: 1000, fuelPerTime: 1, warningThresholds: [100], fuelTags: [lamp-oil]}', 'light: null')
      .replace('combat: null', 'combat: {accuracy: 0, defense: 0, armor: 0, damage: {count: 1, sides: 4, bonus: 0}, range: 6, ammunitionTag: bolt}');
    const root = await fixture({ 'content.yaml': contentFile(compactMonster, weapon, compactVault) });
    await expect(compileContentDirectory({ rootDir: root })).rejects.toThrow(/ammunition tag bolt has no matching ammunition item/i);
  });

  it('rejects unknown balance action-cost identifiers', async () => {
    const root = await fixture({ 'balance.yaml': contentFile(compactBalance.replace('action.move', 'action.teleport')),
      'content.yaml': contentFile(compactMonster, compactItem, compactVault) });
    await expect(compileContentDirectory({ rootDir: root })).rejects.toThrow(/unregistered action cost action\.teleport/i);
  });

  it('enforces balance ordering and monster speed bounds', async () => {
    const invalidBalance = compactBalance.replace('speedMinimum: 25', 'speedMinimum: 200')
      .replace('speedMaximum: 400', 'speedMaximum: 100');
    const fastMonster = compactMonster.replace('speed: 110', 'speed: 401');
    const root = await fixture({ 'balance.yaml': contentFile(invalidBalance),
      'content.yaml': contentFile(fastMonster, compactItem, compactVault) });
    await expect(compileContentDirectory({ rootDir: root })).rejects.toThrow(/speedMinimum.*speedMaximum|speed 401.*bounds/i);
  });

  it('rejects hunger thresholds that do not descend with remaining reserve', async () => {
    const invalid = compactBalance.replace(
      'hungerThresholds: {hungry: 3000, weak: 1000, starving: 0}',
      'hungerThresholds: {hungry: 3000, weak: 5000, starving: 0}',
    );
    const root = await fixture({
      'balance.yaml': contentFile(invalid),
      'content.yaml': contentFile(compactMonster, compactItem, compactVault),
    });
    await expect(compileContentDirectory({ rootDir: root })).rejects.toThrow(
      /starving <= weak <= hungry < hungerMaximum/i,
    );
  });

  it('rejects content missing foundational item content', async () => {
    const root = await fixture({
      'content.yaml': contentFile(compactMonster, compactVault),
    });

    await expectCompileIssues(
      compileContentDirectory({ rootDir: root }),
      [{
        file: root,
        path: '$.entries',
        message: 'missing foundational item content',
      }],
    );
  });

  it('rejects content missing foundational monster content', async () => {
    const root = await fixture({ 'content.yaml': contentFile(compactItem, compactVault) });

    await expectCompileIssues(compileContentDirectory({ rootDir: root }), [{
      file: root,
      path: '$.entries',
      message: 'missing foundational monster content',
    }]);
  });

  it('rejects content missing foundational vault content', async () => {
    const root = await fixture({ 'content.yaml': contentFile(compactMonster, compactItem) });

    await expectCompileIssues(compileContentDirectory({ rootDir: root }), [{
      file: root,
      path: '$.entries',
      message: 'missing foundational vault content',
    }]);
  });

  it.each([
    ['minimum depth', compactVault.replace('minDepth: 1', 'minDepth: 0')],
    ['fractional depth', compactVault.replace('minDepth: 1', 'minDepth: 1.5')],
    ['unsafe depth', compactVault.replace('maxDepth: 5', `maxDepth: ${Number.MAX_SAFE_INTEGER + 1}`)],
    ['depth range', compactVault.replace('minDepth: 1, maxDepth: 5', 'minDepth: 2, maxDepth: 1')],
    ['rarity', compactVault.replace('rarity: common', 'rarity: mythical')],
    ['weight', compactVault.replace('weight: 10', 'weight: 0')],
    ['fractional weight', compactVault.replace('weight: 10', 'weight: 1.5')],
    ['unsafe weight', compactVault.replace('weight: 10', `weight: ${Number.MAX_SAFE_INTEGER + 1}`)],
    ['margin', compactVault.replace('margin: 1', 'margin: -1')],
    ['fractional margin', compactVault.replace('margin: 1', 'margin: 0.5')],
    ['unsafe margin', compactVault.replace('margin: 1', `margin: ${Number.MAX_SAFE_INTEGER + 1}`)],
    ['placement limit', compactVault.replace('maxPerFloor: 1', 'maxPerFloor: 0')],
    ['fractional placement limit', compactVault.replace('maxPerFloor: 1', 'maxPerFloor: 1.5')],
    ['unsafe placement limit', compactVault.replace('maxPerFloor: 1', `maxPerFloor: ${Number.MAX_SAFE_INTEGER + 1}`)],
    ['placement values', compactVault.replace('required: true', 'required: later')],
    ['light radius', compactVault.replace('slot: {id: monster-main, kind: monster, required: true, tags: [guard]}', 'light: {idSuffix: amber, glyph: "*", presentationToken: fixture.lamp, color: [255, 180, 64], radius: 0, strength: 180}')],
    ['light color', compactVault.replace('slot: {id: monster-main, kind: monster, required: true, tags: [guard]}', 'light: {idSuffix: amber, glyph: "*", presentationToken: fixture.lamp, color: [256, 180, 64], radius: 6, strength: 180}')],
    ['light strength', compactVault.replace('slot: {id: monster-main, kind: monster, required: true, tags: [guard]}', 'light: {idSuffix: amber, glyph: "*", presentationToken: fixture.lamp, color: [255, 180, 64], radius: 6, strength: 256}')],
    ['duplicate rotations', compactVault.replace('[0, 180]', '[0, 0]')],
    ['unsorted rotations', compactVault.replace('[0, 180]', '[180, 0]')],
    ['multi-code-point legend key', compactVault.replace('legend: {', 'legend: {xy: {terrain: floor}, ')],
    ['duplicate fixture suffix', compactVault
      .replace('"#+m.#"', '"#+mm#"')
      .replace('slot: {id: monster-main, kind: monster, required: true, tags: [guard]}', 'light: {idSuffix: amber, glyph: "*", presentationToken: fixture.lamp, color: [255, 180, 64], radius: 6, strength: 180}')],
    ['declared-width overflow', compactVault.replace('["#####", "#+m.#", "#####"]', `["+${'.'.repeat(160)}"]`).replace('legend: {"#": {terrain: wall}, ', 'legend: {')],
    ['declared-height overflow', compactVault
      .replace('["#####", "#+m.#", "#####"]', `[${Array.from({ length: 101 }, () => '"+"').join(', ')}]`)
      .replace('legend: {"#": {terrain: wall}, ".": {terrain: floor}, ', 'legend: {')
      .replace(', m: {terrain: floor, slot: {id: monster-main, kind: monster, required: true, tags: [guard]}}', '')],
  ])('rejects invalid vault %s', async (_name, invalidVault) => {
    const root = await fixture({ 'content.yaml': contentFile(compactMonster, compactItem, invalidVault) });
    await expect(compileContentDirectory({ rootDir: root })).rejects.toBeInstanceOf(ContentCompileError);
  });

  it.each([
    [
      'optional slot on void terrain',
      compactVault
        .replace('m: {terrain: floor, slot:', 'm: {terrain: void, slot:')
        .replace('required: true', 'required: false'),
      '$.entries.vault.test-room.legend.m.slot',
      'void terrain cannot contain placement slot monster-main; use non-void terrain or remove the slot',
    ],
    [
      'light on void terrain',
      compactVault.replace(
        'm: {terrain: floor, slot: {id: monster-main, kind: monster, required: true, tags: [guard]}}',
        'm: {terrain: void, light: {idSuffix: void-lamp, glyph: "*", presentationToken: fixture.lamp, color: [255, 180, 64], radius: 6, strength: 180}}',
      ),
      '$.entries.vault.test-room.legend.m.light',
      'void terrain cannot contain light void-lamp; use non-void terrain or remove the light',
    ],
  ] as const)('strict compilation rejects %s', async (_name, invalidVault, path, message) => {
    const root = await fixture({ 'content.yaml': contentFile(compactMonster, compactItem, invalidVault) });

    await expectCompileIssues(compileContentDirectory({ rootDir: root }), [{
      file: 'content.yaml', path, message,
    }]);
  });

  it('includes vault IDs and values in global uniqueness and content hashing', async () => {
    const duplicateRoot = await fixture({
      'a.yaml': contentFile(compactMonster, compactItem, compactVault),
      'b.yaml': contentFile(compactVault),
    });
    await expect(compileContentDirectory({ rootDir: duplicateRoot })).rejects.toThrow(/duplicate vault\.test-room/);

    const changedRoot = await fixture({
      'content.yaml': contentFile(compactMonster, compactItem, compactVault.replace('weight: 10', 'weight: 11')),
    });
    const originalRoot = await fixture({ 'content.yaml': contentFile(compactMonster, compactItem, compactVault) });
    const [changed, original] = await Promise.all([
      compileContentDirectory({ rootDir: changedRoot }),
      compileContentDirectory({ rootDir: originalRoot }),
    ]);
    expect(changed.hash).not.toBe(original.hash);
  });

  it('resolves encounter monster references and quantity bounds', async () => {
    const root = await fixture({ 'content.yaml': contentFile(compactMonster, compactItem, compactVault,
      compactIndividualEncounter.replace('monster.rat, minimumQuantity: 1', 'monster.missing, minimumQuantity: 1')) });
    await expect(compileContentDirectory({ rootDir: root })).rejects.toThrow(/unknown monster reference monster\.missing/i);
  });

  it('accepts encounter selection weight 2^32 exactly and rejects a checked aggregate above it', async () => {
    const weighted = (source: string, id: string, weight: number) => source
      .replace('encounter.rat', id).replace('weight: 1, rarity', `weight: ${weight}, rarity`);
    const atBoundary = await fixture({ 'content.yaml': contentFile(compactMonster, compactItem, compactVault,
      weighted(compactIndividualEncounter, 'encounter.weight-a', 0x8000_0000),
      weighted(compactIndividualEncounter, 'encounter.weight-b', 0x8000_0000)) });
    await expect(compileContentDirectory({ rootDir: atBoundary })).resolves.toBeDefined();
    const above = await fixture({ 'content.yaml': contentFile(compactMonster, compactItem, compactVault,
      weighted(compactIndividualEncounter, 'encounter.weight-a', 0x8000_0000),
      weighted(compactIndividualEncounter, 'encounter.weight-b', 0x8000_0001)) });
    await expect(compileContentDirectory({ rootDir: above })).rejects.toThrow(/encounter weight.*2\^32/i);
  });

  it('caps individual and aggregate group quantities at the runtime-safe encounter limit', async () => {
    const individualBoundary = compactIndividualEncounter.replace('maximumQuantity: 2', 'maximumQuantity: 1024');
    const boundaryRoot = await fixture({ 'content.yaml': contentFile(compactMonster, compactItem, compactVault,
      individualBoundary) });
    await expect(compileContentDirectory({ rootDir: boundaryRoot })).resolves.toBeDefined();
    const individualAbove = await fixture({ 'content.yaml': contentFile(compactMonster, compactItem, compactVault,
      individualBoundary.replace('maximumQuantity: 1024', 'maximumQuantity: 1025')) });
    await expect(compileContentDirectory({ rootDir: individualAbove })).rejects.toThrow(/quantity.*runtime-safe.*1024/i);

    const group = (secondMaximum: number) => `{kind: encounter, id: encounter.group-limit, name: Group, tags: [], model: group, minDepth: 1, maxDepth: 5, environmentTags: [], requiredVaultTags: [], weight: 1, rarity: uncommon, runAppearanceChance: 1, discoveryProtectionIncrement: 0, discoveryProtectionCap: 1, maximumInstancesPerRun: 1, placement: {minimumStairDistance: 2, minimumObjectiveDistance: 2, maximumMemberDistance: 3, allowedTerrainTags: [floor], requiresVaultSlot: false, failureMode: optional}, intentPresentation: {visible: true}, definition: {roles: [{roleId: front, monsterId: monster.rat, minimumQuantity: 1, maximumQuantity: 512, formationPreference: front, behaviorParameters: {}}, {roleId: rear, monsterId: monster.rat, minimumQuantity: 1, maximumQuantity: ${secondMaximum}, formationPreference: rear, behaviorParameters: {}}], formation: line, communicationRadius: 3, leaderChance: 1, leaderRoleId: front, leaderAccentColor: "#ffffff", leaderAlternateGlyph: null, coordinationModifiers: {accuracy: 1, defense: 1, damage: 0}, leaderDeathResponse: weaken, responseParameters: {modifiers: {accuracy: -1, defense: 0, damage: 0}}, supernaturalBond: false, collapseRewards: none}}`;
    const groupBoundary = await fixture({ 'content.yaml': contentFile(compactMonster, compactItem, compactVault, group(512)) });
    await expect(compileContentDirectory({ rootDir: groupBoundary })).resolves.toBeDefined();
    const groupAbove = await fixture({ 'content.yaml': contentFile(compactMonster, compactItem, compactVault, group(513)) });
    await expect(compileContentDirectory({ rootDir: groupAbove })).rejects.toThrow(/group.*quantity.*1024/i);
  });

  it('checks spawn-role weights and caps swarm allocation quantities', async () => {
    const source = compactMonster.replace('tags: [', 'tags: [swarm-source, ');
    const swarm = (secondWeight: number, maximumSpawnQuantity = 256, maximumLivingChildren = 1023) =>
      `{kind: encounter, id: encounter.swarm-limit, name: Swarm, tags: [], model: swarm, minDepth: 1, maxDepth: 5, environmentTags: [], requiredVaultTags: [], weight: 1, rarity: uncommon, runAppearanceChance: 1, discoveryProtectionIncrement: 0, discoveryProtectionCap: 1, maximumInstancesPerRun: 1, placement: {minimumStairDistance: 2, minimumObjectiveDistance: 2, maximumMemberDistance: 3, allowedTerrainTags: [floor], requiresVaultSlot: false, failureMode: optional}, intentPresentation: {visible: true}, definition: {sourceMonsterId: monster.rat, spawnRoles: [{roleId: a, monsterId: monster.rat, weight: 2147483648}, {roleId: b, monsterId: monster.rat, weight: ${secondWeight}}], spawnInterval: 100, minimumSpawnQuantity: 1, maximumSpawnQuantity: ${maximumSpawnQuantity}, placementRadius: 2, allowedTerrainTags: [floor], maximumLivingChildren: ${maximumLivingChildren}, maximumLivingMembers: 1024, maximumFloorActors: 1024, sourceDestructionResponse: stop, responseParameters: {}}}`;
    const boundary = await fixture({ 'content.yaml': contentFile(source, compactItem, compactVault, swarm(2147483648)) });
    await expect(compileContentDirectory({ rootDir: boundary })).resolves.toBeDefined();
    for (const invalid of [swarm(2147483649), swarm(2147483648, 257), swarm(2147483648, 256, 1024)]) {
      const root = await fixture({ 'content.yaml': contentFile(source, compactItem, compactVault, invalid) });
      await expect(compileContentDirectory({ rootDir: root })).rejects.toThrow(/spawn-role weight.*2\^32|spawn quantity.*256|living children.*1023/i);
    }
  });

  it('requires supernatural group collapse and a declared leader role', async () => {
    const group = '{kind: encounter, id: encounter.group, name: Group, tags: [], model: group, minDepth: 1, maxDepth: 5, environmentTags: [], requiredVaultTags: [], weight: 1, rarity: uncommon, runAppearanceChance: 1, discoveryProtectionIncrement: 0, discoveryProtectionCap: 1, maximumInstancesPerRun: 1, placement: {minimumStairDistance: 2, minimumObjectiveDistance: 2, maximumMemberDistance: 3, allowedTerrainTags: [floor], requiresVaultSlot: false, failureMode: optional}, intentPresentation: {visible: true}, definition: {roles: [{roleId: guard, monsterId: monster.rat, minimumQuantity: 2, maximumQuantity: 3, formationPreference: front, behaviorParameters: {}}], formation: line, communicationRadius: 3, leaderChance: 1, leaderRoleId: captain, leaderAccentColor: "#ffffff", leaderAlternateGlyph: null, coordinationModifiers: {accuracy: 1, defense: 1, damage: 0}, leaderDeathResponse: collapse, responseParameters: {}, supernaturalBond: false, collapseRewards: none}}';
    const root = await fixture({ 'content.yaml': contentFile(compactMonster, compactItem, compactVault, group) });
    await expect(compileContentDirectory({ rootDir: root })).rejects.toThrow(/leader role captain|collapse requires supernaturalBond/i);
  });

  it('validates swarm source tags and cap relationships', async () => {
    const swarm = '{kind: encounter, id: encounter.swarm, name: Swarm, tags: [], model: swarm, minDepth: 1, maxDepth: 5, environmentTags: [], requiredVaultTags: [], weight: 1, rarity: uncommon, runAppearanceChance: 1, discoveryProtectionIncrement: 0, discoveryProtectionCap: 1, maximumInstancesPerRun: 1, placement: {minimumStairDistance: 2, minimumObjectiveDistance: 2, maximumMemberDistance: 3, allowedTerrainTags: [floor], requiresVaultSlot: false, failureMode: optional}, intentPresentation: {visible: true}, definition: {sourceMonsterId: monster.rat, spawnRoles: [{roleId: rat, monsterId: monster.rat, weight: 1}], spawnInterval: 100, minimumSpawnQuantity: 1, maximumSpawnQuantity: 2, placementRadius: 2, allowedTerrainTags: [floor], maximumLivingChildren: 5, maximumLivingMembers: 5, maximumFloorActors: 4, sourceDestructionResponse: stop, responseParameters: {}}}';
    const root = await fixture({ 'content.yaml': contentFile(compactMonster, compactItem, compactVault, swarm) });
    await expect(compileContentDirectory({ rootDir: root })).rejects.toThrow(/swarm-source|maximum living members|maximum floor actors/i);
  });

  it('validates boss uniqueness, phase order, and reward kinds', async () => {
    const boss = '{kind: encounter, id: encounter.boss, name: Boss, tags: [], model: boss, minDepth: 5, maxDepth: 5, environmentTags: [], requiredVaultTags: [], weight: 1, rarity: legendary, runAppearanceChance: 0.08, discoveryProtectionIncrement: 0.03, discoveryProtectionCap: 0.35, maximumInstancesPerRun: 2, placement: {minimumStairDistance: 5, minimumObjectiveDistance: 5, maximumMemberDistance: 0, allowedTerrainTags: [floor], requiresVaultSlot: false, failureMode: optional}, intentPresentation: {visible: true}, definition: {monsterId: monster.rat, phases: [{phaseId: late, healthThresholdPercent: 40, behaviorId: behavior.approach-and-attack, behaviorParameters: {}, modifiers: {accuracy: 1, defense: 0, damage: 1}, effects: []}, {phaseId: early, healthThresholdPercent: 60, behaviorId: behavior.approach-and-attack, behaviorParameters: {}, modifiers: {accuracy: 1, defense: 0, damage: 1}, effects: []}], recoveryPerWorldTime: 0.01, recoveryCapPercent: 20, uniqueItemId: monster.rat, enhancedLootTableId: loot-table.missing, vaultTags: []}}';
    const root = await fixture({ 'content.yaml': contentFile(compactMonster, compactItem, compactVault, boss) });
    await expect(compileContentDirectory({ rootDir: root })).rejects.toThrow(/maximumInstancesPerRun 1|strictly descending|resolves to monster|unknown loot-table/i);
  });

  it('rejects a boss enhanced-loot graph that reaches its guaranteed unique item', async () => {
    const nested = '{kind: loot-table, id: loot-table.nested, name: Nested, tags: [], rolls: 1, choices: [{contentId: item.lantern, lootTableId: null, weight: 1, minimumQuantity: 1, maximumQuantity: 1}]}';
    const loot = '{kind: loot-table, id: loot-table.boss, name: Boss loot, tags: [], rolls: 1, choices: [{contentId: null, lootTableId: loot-table.nested, weight: 1, minimumQuantity: 1, maximumQuantity: 1}]}';
    const boss = '{kind: encounter, id: encounter.boss, name: Boss, tags: [], model: boss, minDepth: 1, maxDepth: 5, environmentTags: [], requiredVaultTags: [], weight: 1, rarity: legendary, runAppearanceChance: 1, discoveryProtectionIncrement: 0, discoveryProtectionCap: 1, maximumInstancesPerRun: 1, placement: {minimumStairDistance: 1, minimumObjectiveDistance: 1, maximumMemberDistance: 0, allowedTerrainTags: [floor], requiresVaultSlot: false, failureMode: optional}, intentPresentation: {visible: true}, definition: {monsterId: monster.rat, phases: [], recoveryPerWorldTime: 0, recoveryCapPercent: 0, uniqueItemId: item.lantern, enhancedLootTableId: loot-table.boss, vaultTags: []}}';
    const root = await fixture({ 'content.yaml': contentFile(compactMonster, compactItem, compactVault, nested, loot, boss) });
    await expect(compileContentDirectory({ rootDir: root })).rejects.toThrow(/enhanced loot.*guaranteed.*unique/i);
  });

  it('rejects any ordinary loot graph that reaches another boss guaranteed unique item', async () => {
    const uniqueB = compactItem.replace('item.lantern', 'item.unique-b');
    const ordinary = compactItem.replace('item.lantern', 'item.ordinary');
    const lootA = '{kind: loot-table, id: loot-table.boss-a, name: Boss A loot, tags: [], rolls: 1, choices: [{contentId: item.unique-b, lootTableId: null, weight: 1, minimumQuantity: 1, maximumQuantity: 1}]}';
    const lootB = '{kind: loot-table, id: loot-table.boss-b, name: Boss B loot, tags: [], rolls: 1, choices: [{contentId: item.ordinary, lootTableId: null, weight: 1, minimumQuantity: 1, maximumQuantity: 1}]}';
    const boss = (id: string, unique: string, loot: string) => `{kind: encounter, id: ${id}, name: Boss, tags: [], model: boss, minDepth: 1, maxDepth: 5, environmentTags: [], requiredVaultTags: [], weight: 1, rarity: legendary, runAppearanceChance: 1, discoveryProtectionIncrement: 0, discoveryProtectionCap: 1, maximumInstancesPerRun: 1, placement: {minimumStairDistance: 1, minimumObjectiveDistance: 1, maximumMemberDistance: 0, allowedTerrainTags: [floor], requiresVaultSlot: false, failureMode: optional}, intentPresentation: {visible: true}, definition: {monsterId: monster.rat, phases: [], recoveryPerWorldTime: 0, recoveryCapPercent: 0, uniqueItemId: ${unique}, enhancedLootTableId: ${loot}, vaultTags: []}}`;
    const root = await fixture({ 'content.yaml': contentFile(compactMonster, compactItem, uniqueB, ordinary, compactVault,
      lootA, lootB, boss('encounter.boss-a', 'item.lantern', 'loot-table.boss-a'),
      boss('encounter.boss-b', 'item.unique-b', 'loot-table.boss-b')) });
    await expect(compileContentDirectory({ rootDir: root })).rejects.toThrow(/boss-unique.*ordinary loot/i);
  });

  it.each([
    ['effect.hunger.restore', '{amount: 1}'],
    ['effect.item.consume', '{quantity: 1}'],
    ['effect.force-move', '{distance: 1}'],
  ] as const)('rejects %s in the closed boss phase effect subset', async (effectId, parameters) => {
    const ordinary = compactItem.replace('item.lantern', 'item.ordinary');
    const loot = '{kind: loot-table, id: loot-table.boss, name: Boss loot, tags: [], rolls: 1, choices: [{contentId: item.ordinary, lootTableId: null, weight: 1, minimumQuantity: 1, maximumQuantity: 1}]}';
    const boss = `{kind: encounter, id: encounter.boss, name: Boss, tags: [], model: boss, minDepth: 1, maxDepth: 5, environmentTags: [], requiredVaultTags: [], weight: 1, rarity: legendary, runAppearanceChance: 1, discoveryProtectionIncrement: 0, discoveryProtectionCap: 1, maximumInstancesPerRun: 1, placement: {minimumStairDistance: 1, minimumObjectiveDistance: 1, maximumMemberDistance: 0, allowedTerrainTags: [floor], requiresVaultSlot: false, failureMode: optional}, intentPresentation: {visible: true}, definition: {monsterId: monster.rat, phases: [{phaseId: changed, healthThresholdPercent: 50, behaviorId: behavior.approach-and-attack, behaviorParameters: {}, modifiers: {accuracy: 1, defense: 0, damage: 1}, effects: [{effectId: ${effectId}, parameters: ${parameters}, requiresLivingTarget: false}]}], recoveryPerWorldTime: 0, recoveryCapPercent: 0, uniqueItemId: item.lantern, enhancedLootTableId: loot-table.boss, vaultTags: []}}`;
    const root = await fixture({ 'content.yaml': contentFile(compactMonster, compactItem, ordinary, compactVault, loot, boss) });
    await expectCompileIssues(compileContentDirectory({ rootDir: root }), [{
      file: 'content.yaml',
      path: '$.entries.encounter.boss.definition.phases.0.effects.0.effectId',
      message: `boss phases do not support effect ${effectId}`,
    }]);
  });

  it('accepts every effect in the closed boss phase subset', async () => {
    const ordinary = compactItem.replace('item.lantern', 'item.ordinary');
    const loot = '{kind: loot-table, id: loot-table.boss, name: Boss loot, tags: [], rolls: 1, choices: [{contentId: item.ordinary, lootTableId: null, weight: 1, minimumQuantity: 1, maximumQuantity: 1}]}';
    const effects = '[{effectId: effect.damage, parameters: {damageType: fire, dice: {count: 1, sides: 1, bonus: 0}}, requiresLivingTarget: true}, {effectId: effect.heal, parameters: {dice: {count: 1, sides: 1, bonus: 0}}, requiresLivingTarget: true}, {effectId: effect.condition.apply, parameters: {conditionId: condition.stunned, duration: 100}, requiresLivingTarget: true}, {effectId: effect.condition.remove, parameters: {conditionId: condition.stunned}, requiresLivingTarget: false}, {effectId: effect.reveal, parameters: {radius: 3}, requiresLivingTarget: false}, {effectId: effect.fuel.transfer, parameters: {maximum: 3}, requiresLivingTarget: false}, {effectId: effect.light.toggle, parameters: {enabled: false}, requiresLivingTarget: false}, {effectId: effect.feature.mutate, parameters: {state: door.open}, requiresLivingTarget: false}]';
    const boss = `{kind: encounter, id: encounter.boss, name: Boss, tags: [], model: boss, minDepth: 1, maxDepth: 5, environmentTags: [], requiredVaultTags: [], weight: 1, rarity: legendary, runAppearanceChance: 1, discoveryProtectionIncrement: 0, discoveryProtectionCap: 1, maximumInstancesPerRun: 1, placement: {minimumStairDistance: 1, minimumObjectiveDistance: 1, maximumMemberDistance: 0, allowedTerrainTags: [floor], requiresVaultSlot: false, failureMode: optional}, intentPresentation: {visible: true}, definition: {monsterId: monster.rat, phases: [{phaseId: changed, healthThresholdPercent: 50, behaviorId: behavior.approach-and-attack, behaviorParameters: {}, modifiers: {accuracy: 1, defense: 0, damage: 1}, effects: ${effects}}], recoveryPerWorldTime: 0, recoveryCapPercent: 0, uniqueItemId: item.lantern, enhancedLootTableId: loot-table.boss, vaultTags: []}}`;
    const root = await fixture({ 'content.yaml': contentFile(
      compactMonster, compactItem, ordinary, compactVault, compactTimedCondition, loot, boss,
    ) });
    await expect(compileContentDirectory({ rootDir: root })).resolves.toMatchObject({ schemaVersion: 7 });
  });

  it('validates Champion and Echo template references and weaker limits', async () => {
    const template = '{kind: fallen-champion-template, id: fallen-champion-template.core, name: Champion, tags: [], fallbackMonsterId: monster.rat, fallbackItemId: item.lantern, minimumHealth: 10, maximumHealth: 100, attributeMaximum: 30, damageMaximum: 30, abilityLimit: 2, echoAppearanceChance: 0.08, maximumEchoesPerRun: 2, echoHealthPercent: 65, echoDamagePercent: 70, echoDefensePercent: 80, echoAbilityLimit: 3, echoLootTableId: item.lantern, heirloomSelection: {rarityWeights: {common: 1, uncommon: 3, rare: 8, legendary: 16}, qualityRankBonus: 2}}';
    const root = await fixture({ 'content.yaml': contentFile(compactMonster, compactItem, compactVault, template) });
    await expect(compileContentDirectory({ rootDir: root })).rejects.toThrow(/Echo ability limit|loot-table reference item\.lantern resolves to item/i);
  });

  it('requires every enabled Echo ability cap to be strictly below the Champion cap', async () => {
    const loot = '{kind: loot-table, id: loot-table.echo, name: Echo loot, tags: [], rolls: 1, choices: [{contentId: item.lantern, lootTableId: null, weight: 1, minimumQuantity: 1, maximumQuantity: 1}]}';
    const template = '{kind: fallen-champion-template, id: fallen-champion-template.core, name: Champion, tags: [], fallbackMonsterId: monster.rat, fallbackItemId: item.lantern, minimumHealth: 10, maximumHealth: 100, attributeMaximum: 30, damageMaximum: 30, abilityLimit: 2, echoAppearanceChance: 0.08, maximumEchoesPerRun: 2, echoHealthPercent: 65, echoDamagePercent: 70, echoDefensePercent: 80, echoAbilityLimit: 2, echoLootTableId: loot-table.echo, heirloomSelection: {rarityWeights: {common: 1, uncommon: 3, rare: 8, legendary: 16}, qualityRankBonus: 2}}';
    const root = await fixture({ 'content.yaml': contentFile(compactMonster, compactItem, compactVault, loot, template) });
    await expect(compileContentDirectory({ rootDir: root })).rejects.toThrow(/strictly below Champion ability limit/i);
  });

  it('rejects enabled Echoes when current Champion combat minima cannot be strictly weakened', async () => {
    const weakMonster = compactMonster.replace('health: 4', 'health: 1')
      .replace('accuracy: 1', 'accuracy: 0').replace('defense: 10', 'defense: 0');
    const loot = '{kind: loot-table, id: loot-table.echo, name: Echo loot, tags: [], rolls: 1, choices: [{contentId: item.lantern, lootTableId: null, weight: 1, minimumQuantity: 1, maximumQuantity: 1}]}';
    const template = '{kind: fallen-champion-template, id: fallen-champion-template.core, name: Champion, tags: [], fallbackMonsterId: monster.rat, fallbackItemId: item.lantern, minimumHealth: 1, maximumHealth: 1, attributeMaximum: 1, damageMaximum: 1, abilityLimit: 1, echoAppearanceChance: 0.08, maximumEchoesPerRun: 2, echoHealthPercent: 65, echoDamagePercent: 70, echoDefensePercent: 80, echoAbilityLimit: 0, echoLootTableId: loot-table.echo, heirloomSelection: {rarityWeights: {common: 1, uncommon: 3, rare: 8, legendary: 16}, qualityRankBonus: 2}}';
    const root = await fixture({ 'content.yaml': contentFile(weakMonster, compactItem, compactVault, loot, template) });
    await expect(compileContentDirectory({ rootDir: root })).rejects.toThrow(/strict minimum|strictly weaken|Echoes require Champion/i);
  });

  it('rejects a Champion Echo loot graph that can reach a guaranteed boss-unique item', async () => {
    const leaf = '{kind: loot-table, id: loot-table.echo-leaf, name: Echo leaf, tags: [], rolls: 1, choices: [{contentId: item.lantern, lootTableId: null, weight: 1, minimumQuantity: 1, maximumQuantity: 1}]}';
    const echo = '{kind: loot-table, id: loot-table.echo, name: Echo loot, tags: [], rolls: 1, choices: [{contentId: null, lootTableId: loot-table.echo-leaf, weight: 1, minimumQuantity: 1, maximumQuantity: 1}]}';
    const bossLoot = '{kind: loot-table, id: loot-table.boss, name: Boss loot, tags: [], rolls: 1, choices: [{contentId: item.lantern, lootTableId: null, weight: 1, minimumQuantity: 1, maximumQuantity: 1}]}';
    const boss = '{kind: encounter, id: encounter.boss, name: Boss, tags: [], model: boss, minDepth: 1, maxDepth: 5, environmentTags: [], requiredVaultTags: [], weight: 1, rarity: legendary, runAppearanceChance: 1, discoveryProtectionIncrement: 0, discoveryProtectionCap: 1, maximumInstancesPerRun: 1, placement: {minimumStairDistance: 1, minimumObjectiveDistance: 1, maximumMemberDistance: 0, allowedTerrainTags: [floor], requiresVaultSlot: false, failureMode: optional}, intentPresentation: {visible: true}, definition: {monsterId: monster.rat, phases: [], recoveryPerWorldTime: 0, recoveryCapPercent: 0, uniqueItemId: item.lantern, enhancedLootTableId: loot-table.boss, vaultTags: []}}';
    const template = '{kind: fallen-champion-template, id: fallen-champion-template.core, name: Champion, tags: [], fallbackMonsterId: monster.rat, fallbackItemId: item.lantern, minimumHealth: 10, maximumHealth: 100, attributeMaximum: 30, damageMaximum: 30, abilityLimit: 2, echoAppearanceChance: 0.08, maximumEchoesPerRun: 2, echoHealthPercent: 65, echoDamagePercent: 70, echoDefensePercent: 80, echoAbilityLimit: 1, echoLootTableId: loot-table.echo, heirloomSelection: {rarityWeights: {common: 1, uncommon: 3, rare: 8, legendary: 16}, qualityRankBonus: 2}}';
    const root = await fixture({ 'content.yaml': contentFile(
      compactMonster, compactItem, compactVault, leaf, echo, bossLoot, boss, template,
    ) });
    await expect(compileContentDirectory({ rootDir: root })).rejects.toThrow(/Echo loot.*guaranteed.*unique|boss-unique/i);
  });

  it('aborts between content discovery and file processing boundaries', async () => {
    const root = await fixture({
      'a.yaml': contentFile(compactMonster),
      'b.yaml': contentFile(compactItem, compactVault),
    });
    const controller = new AbortController();
    const nativeThrow = controller.signal.throwIfAborted.bind(controller.signal);
    let boundaries = 0;
    controller.signal.throwIfAborted = () => {
      boundaries += 1;
      if (boundaries === 10) controller.abort();
      nativeThrow();
    };

    await expect(
      compileContentDirectory({ rootDir: root, signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(boundaries).toBe(10);
  });
});
