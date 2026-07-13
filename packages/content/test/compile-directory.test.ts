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

const compactMonster = '{kind: monster, id: monster.rat, name: Rat, glyph: r, color: "#aaaaaa", tags: [defense, food, healing, identification, light, offense], minDepth: 1, maxDepth: 5, attributes: {might: 3, agility: 8, vitality: 4, wits: 2, resolve: 2}, health: 4, speed: 110, accuracy: 1, defense: 10, perception: 6, damage: {count: 1, sides: 3, bonus: 0}, armor: 0, resistances: {physical: 0, fire: 0, cold: 0, lightning: 0, poison: 0, arcane: 0}, disposition: hostile, behaviorId: behavior.approach-and-attack, behaviorParameters: {}, runAppearanceChance: 1, rarity: common}';
const compactItem = '{kind: item, id: item.lantern, name: Lantern, glyph: "¤", color: "#eeeeaa", tags: [defense, food, healing, identification, light, offense], minDepth: 1, maxDepth: 20, category: light, stackLimit: 1, price: 4, rarity: common, actionCost: 100, equipment: {slots: [off-hand], handedness: one-handed, reservedSlots: []}, combat: null, light: {color: [255, 200, 100], radius: 6, strength: 180, fuelCapacity: 1000, fuelPerTime: 1, warningThresholds: [100], fuelTags: [lamp-oil]}, identification: {mode: known, groupId: null, appearances: []}, effects: []}';
const compactBalance = '{kind: balance, id: balance.core, name: Core, tags: [core], readinessThreshold: 100, normalActionCost: 100, speedMinimum: 25, speedMaximum: 400, energyMinimum: -10000, energyMaximum: 10000, attributeMinimum: 0, attributeMaximum: 30, hungerMaximum: 10000, hungerThresholds: {hungry: 3000, weak: 1000, starving: 0}, starvationInterval: 500, starvationDamage: 1, recoveryInterval: 500, recoveryAmount: 1, restMaximumDuration: 5000, recoveryByHungerStage: {sated: 100, hungry: 50, weak: 0, starving: 0}, hungerStageModifiers: {sated: {}, hungry: {}, weak: {}, starving: {}}, formulas: {health: {base: 8, vitality: 2}}, actionCosts: {action.move: 100}}';
const compactTimedCondition = '{kind: condition, id: condition.stunned, name: Stunned, description: Cannot act, tags: [control], color: "#d8c46a", duration: {mode: timed, default: 100, maximum: 500}, stacking: {mode: refresh, maximumStacks: 1}, modifiersPerStack: {defense: -2}, traits: [condition-trait.incapacitated]}';
const compactPermanentCondition = '{kind: condition, id: condition.warded, name: Warded, description: Remains until removed, tags: [beneficial], color: "#80b8ff", duration: {mode: permanent, default: null, maximum: null}, stacking: {mode: refresh, maximumStacks: 1}, modifiersPerStack: {}, traits: []}';

function contentFile(...entries: readonly string[]): string {
  return `schemaVersion: 2\nentries: [${entries.join(', ')}]\n`;
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

  it('requires shuffled identification pools to be a bijection', async () => {
    const potion = (id: string) => compactItem.replace('item.lantern', id)
      .replace('category: light', 'category: potion')
      .replace('equipment: {slots: [off-hand], handedness: one-handed, reservedSlots: []}', 'equipment: null')
      .replace(/light: \{[^}]+\}/, 'light: null')
      .replace('identification: {mode: known, groupId: null, appearances: []}',
        'identification: {mode: shuffled, groupId: identification.potions, appearances: [appearance.one, appearance.two, appearance.three]}');
    const root = await fixture({ 'content.yaml': contentFile(compactMonster, compactVault,
      potion('item.potion-one'), potion('item.potion-two')) });
    await expect(compileContentDirectory({ rootDir: root })).rejects.toThrow(/identification group identification\.potions.*bijection/i);
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
