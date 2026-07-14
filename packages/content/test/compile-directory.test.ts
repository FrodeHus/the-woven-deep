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

const compactMonster = '{kind: monster, id: monster.rat, name: Rat, glyph: r, color: "#aaaaaa", tags: [defense, food, healing, identification, light, offense], minDepth: 1, maxDepth: 5, attributes: {might: 3, agility: 8, vitality: 4, wits: 2, resolve: 2}, health: 4, speed: 110, accuracy: 1, defense: 10, perception: 6, damage: {count: 1, sides: 3, bonus: 0}, armor: 0, resistances: {physical: 0, fire: 0, cold: 0, lightning: 0, poison: 0, arcane: 0}, disposition: hostile, behaviorId: behavior.approach-and-attack, behaviorParameters: {}, rarity: common}';
const compactItem = '{kind: item, id: item.lantern, name: Lantern, glyph: "¤", color: "#eeeeaa", tags: [defense, food, healing, identification, light, offense], minDepth: 1, maxDepth: 20, category: light, stackLimit: 1, price: 4, rarity: common, actionCost: 100, equipment: {slots: [off-hand], handedness: one-handed, reservedSlots: []}, combat: null, light: {color: [255, 200, 100], radius: 6, strength: 180, fuelCapacity: 1000, fuelPerTime: 1, warningThresholds: [100], fuelTags: [lamp-oil]}, identification: {mode: known, poolId: null}, effects: []}';
const compactBalance = '{kind: balance, id: balance.core, name: Core, tags: [core], readinessThreshold: 100, normalActionCost: 100, speedMinimum: 25, speedMaximum: 400, energyMinimum: -10000, energyMaximum: 10000, attributeMinimum: 0, attributeMaximum: 30, hungerMaximum: 10000, hungerThresholds: {hungry: 3000, weak: 1000, starving: 0}, starvationInterval: 500, starvationDamage: 1, recoveryInterval: 500, recoveryAmount: 1, restMaximumDuration: 5000, recoveryByHungerStage: {sated: 100, hungry: 50, weak: 0, starving: 0}, hungerStageModifiers: {sated: {}, hungry: {}, weak: {}, starving: {}}, formulas: {health: {base: 8, vitality: 2}}, actionCosts: {action.move: 100}}';
const compactTimedCondition = '{kind: condition, id: condition.stunned, name: Stunned, description: Cannot act, tags: [control], color: "#d8c46a", duration: {mode: timed, default: 100, maximum: 500}, stacking: {mode: refresh, maximumStacks: 1}, modifiersPerStack: {defense: -2}, traits: [condition-trait.incapacitated]}';
const compactPermanentCondition = '{kind: condition, id: condition.warded, name: Warded, description: Remains until removed, tags: [beneficial], color: "#80b8ff", duration: {mode: permanent, default: null, maximum: null}, stacking: {mode: refresh, maximumStacks: 1}, modifiersPerStack: {}, traits: []}';
const compactIndividualEncounter = '{kind: encounter, id: encounter.rat, name: Rat encounter, tags: [], model: individual, minDepth: 1, maxDepth: 5, environmentTags: [], requiredVaultTags: [], weight: 1, rarity: common, runAppearanceChance: 1, discoveryProtectionIncrement: 0, discoveryProtectionCap: 1, maximumInstancesPerRun: 3, placement: {minimumStairDistance: 2, minimumObjectiveDistance: 2, maximumMemberDistance: 2, allowedTerrainTags: [floor], requiresVaultSlot: false, failureMode: optional}, intentPresentation: {visible: true}, definition: {monsterId: monster.rat, minimumQuantity: 1, maximumQuantity: 2}}';

function contentFile(...entries: readonly string[]): string {
  return `schemaVersion: 3\nentries: [${entries.join(', ')}]\n`;
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
    await expect(compileContentDirectory({ rootDir: root })).resolves.toMatchObject({ schemaVersion: 3 });
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
