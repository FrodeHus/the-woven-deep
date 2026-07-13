import { describe, expect, it } from 'vitest';
import { ContentCompileError, parseContentFile } from '../src/compiler/index.js';

describe('parseContentFile', () => {
  it('rejects source schema v1 with a stable version diagnostic', () => {
    expect(() => parseContentFile({
      path: 'legacy.yaml',
      source: 'schemaVersion: 1\nentries: []\n',
    })).toThrow(/legacy\.yaml.*schemaVersion.*expected 2/i);
  });

  it('applies defaults to a strict monster entry', () => {
    const [entry] = parseContentFile({
      path: 'monsters/rat.yaml',
      source: `schemaVersion: 2
entries:
  - kind: monster
    id: monster.cave-rat
    name: Cave rat
    glyph: r
    color: '#a89b82'
    minDepth: 1
    maxDepth: 5
    attributes: { might: 4, agility: 8, vitality: 4, wits: 3, resolve: 2 }
    health: 4
    speed: 100
    accuracy: 1
    defense: 10
    perception: 6
    damage: { count: 1, sides: 3, bonus: 0 }
    armor: 0
    resistances: { physical: 0, fire: 0, cold: 0, lightning: 0, poison: 0, arcane: 0 }
    disposition: hostile
    behaviorId: behavior.approach-and-attack
    runAppearanceChance: 1
    rarity: common
`,
    });

    expect(entry).toMatchObject({
      id: 'monster.cave-rat',
      tags: [],
      runAppearanceChance: 1,
    });
  });

  it('parses strict timed and permanent condition definitions', () => {
    const entries = parseContentFile({
      path: 'conditions/control.yaml',
      source: `schemaVersion: 2
entries:
  - kind: condition
    id: condition.stunned
    name: Stunned
    description: Cannot take normal actions or reactions.
    tags: [control, harmful]
    color: "#d8c46a"
    duration: { mode: timed, default: 100, maximum: 500 }
    stacking: { mode: intensify, maximumStacks: 3 }
    modifiersPerStack: { defense: -2 }
    traits: [condition-trait.incapacitated, condition-trait.suppresses-reactions]
  - kind: condition
    id: condition.warded
    name: Warded
    description: Protected until explicitly removed.
    tags: [beneficial]
    color: "#80b8ff"
    duration: { mode: permanent, default: null, maximum: null }
    stacking: { mode: refresh, maximumStacks: 1 }
    modifiersPerStack: { defense: 1 }
    traits: []
`,
    });

    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'condition', id: 'condition.stunned' }),
      expect.objectContaining({ kind: 'condition', id: 'condition.warded' }),
    ]));
  });

  it.each([
    ['unknown modifier', 'modifiersPerStack: { luck: 1 }', /modifiersPerStack\.luck/i],
    ['unknown trait', 'traits: [condition-trait.unknown]', /traits\.0/i],
    ['duplicate traits', 'traits: [condition-trait.incapacitated, condition-trait.incapacitated]', /unique and sorted/i],
    ['unsorted traits', 'traits: [condition-trait.suppresses-reactions, condition-trait.incapacitated]', /unique and sorted/i],
    ['default above maximum', 'duration: { mode: timed, default: 501, maximum: 500 }', /default duration/i],
    ['permanent numeric duration', 'duration: { mode: permanent, default: 100, maximum: 100 }', /duration\.default/i],
    ['refresh with multiple stacks', 'stacking: { mode: refresh, maximumStacks: 2 }', /maximumStacks/i],
  ])('rejects condition with %s', (_label, replacement, message) => {
    const base = `schemaVersion: 2
entries:
  - kind: condition
    id: condition.stunned
    name: Stunned
    description: Cannot act.
    tags: [control]
    color: "#d8c46a"
    duration: { mode: timed, default: 100, maximum: 500 }
    stacking: { mode: refresh, maximumStacks: 1 }
    modifiersPerStack: { defense: -2 }
    traits: [condition-trait.incapacitated]
`;
    const source = replacement.startsWith('modifiersPerStack:')
      ? base.replace('modifiersPerStack: { defense: -2 }', replacement)
      : replacement.startsWith('traits:')
        ? base.replace('traits: [condition-trait.incapacitated]', replacement)
        : replacement.startsWith('duration:')
          ? base.replace('duration: { mode: timed, default: 100, maximum: 500 }', replacement)
          : base.replace('stacking: { mode: refresh, maximumStacks: 1 }', replacement);
    expect(() => parseContentFile({ path: 'conditions/invalid.yaml', source })).toThrow(message);
  });

  it('parses strict item, spell, trap, loot-table, and balance entries', () => {
    const entries = parseContentFile({
      path: 'gameplay.yaml',
      source: `schemaVersion: 2
entries:
  - { kind: item, id: item.sword, name: Sword, glyph: "/", color: "#dddddd", tags: [], minDepth: 1, maxDepth: 20, category: weapon, stackLimit: 1, price: 20, rarity: common, actionCost: 100, equipment: { slots: [main-hand], handedness: one-handed, reservedSlots: [] }, combat: { accuracy: 1, defense: 0, armor: 0, damage: { count: 1, sides: 6, bonus: 0 }, range: 1, ammunitionTag: null }, light: null, identification: { mode: known, groupId: null, appearances: [] }, effects: [] }
  - { kind: spell, id: spell.mend, name: Mend, tags: [], targetingId: target.self, range: 0, actionCost: 100, effects: [{ effectId: effect.heal, parameters: { dice: { count: 1, sides: 4, bonus: 0 } } }] }
  - { kind: trap, id: trap.dart, name: Dart trap, glyph: "^", color: "#aaaaaa", tags: [], targetingId: target.actor, discoveryDifficulty: 5, disarmDifficulty: 6, disarmOutcomes: { failure: safe, criticalFailure: trigger, toolDamage: 10 }, resetMode: once, effects: [{ effectId: effect.damage, parameters: { damageType: physical, dice: { count: 1, sides: 4, bonus: 0 } } }] }
  - { kind: loot-table, id: loot-table.basic, name: Basic loot, tags: [], rolls: 1, choices: [{ contentId: item.sword, lootTableId: null, weight: 1, minimumQuantity: 1, maximumQuantity: 1 }] }
  - { kind: balance, id: balance.core, name: Core, tags: [], readinessThreshold: 100, normalActionCost: 100, speedMinimum: 25, speedMaximum: 400, energyMinimum: -10000, energyMaximum: 10000, attributeMinimum: 0, attributeMaximum: 30, hungerMaximum: 10000, hungerThresholds: { hungry: 3000, weak: 1000, starving: 0 }, starvationInterval: 500, starvationDamage: 1, recoveryInterval: 500, recoveryAmount: 1, restMaximumDuration: 5000, recoveryByHungerStage: { sated: 100, hungry: 50, weak: 0, starving: 0 }, hungerStageModifiers: { sated: {}, hungry: {}, weak: {}, starving: {} }, formulas: { health: { base: 8, vitality: 2 } }, actionCosts: { action.move: 100 } }
`,
    });

    expect(entries.map((entry) => entry.kind)).toEqual(['item', 'spell', 'trap', 'loot-table', 'balance']);
    expect(entries[1]).toMatchObject({ effects: [{ requiresLivingTarget: false }] });
  });

  it.each([
    ['dice count', 'damage: { count: 0, sides: 3, bonus: 0 }', /entries\.monster\.cave-rat\.damage\.count/],
    ['non-positive speed', 'speed: 100', /entries\.monster\.cave-rat\.speed/],
  ])('rejects invalid %s with a stable path', (_name, replacement, path) => {
    const source = `schemaVersion: 2
entries:
  - kind: monster
    id: monster.cave-rat
    name: Cave rat
    glyph: r
    color: '#a89b82'
    minDepth: 1
    maxDepth: 5
    attributes: { might: 4, agility: 8, vitality: 4, wits: 3, resolve: 2 }
    health: 4
    speed: 100
    accuracy: 1
    defense: 10
    perception: 6
    damage: { count: 1, sides: 3, bonus: 0 }
    armor: 0
    resistances: { physical: 0, fire: 0, cold: 0, lightning: 0, poison: 0, arcane: 0 }
    disposition: hostile
    behaviorId: behavior.approach-and-attack
    runAppearanceChance: 1
    rarity: common
`.replace(replacement === 'speed: 100' ? replacement : 'damage: { count: 1, sides: 3, bonus: 0 }', replacement === 'speed: 100' ? 'speed: 0' : replacement);
    expect(() => parseContentFile({ path: 'invalid.yaml', source })).toThrow(path);
  });

  it('rejects unknown targeting rules with a stable path', () => {
    expect(() => parseContentFile({
      path: 'spell.yaml',
      source: 'schemaVersion: 2\nentries: [{kind: spell, id: spell.bad, name: Bad, tags: [], targetingId: target.unknown, range: 1, actionCost: 100, effects: [{effectId: effect.heal, parameters: {dice: {count: 1, sides: 4, bonus: 0}}}]}]\n',
    })).toThrow(/entries\.spell\.bad\.targetingId/);
  });

  it('rejects a negative action cost with a stable path', () => {
    expect(() => parseContentFile({
      path: 'spell.yaml',
      source: 'schemaVersion: 2\nentries: [{kind: spell, id: spell.bad, name: Bad, tags: [], targetingId: target.self, range: 0, actionCost: -1, effects: [{effectId: effect.heal, parameters: {dice: {count: 1, sides: 4, bonus: 0}}}]}]\n',
    })).toThrow(/entries\.spell\.bad\.actionCost/);
  });

  it('materializes defaults and derived metadata for a strict vault entry', () => {
    const [entry] = parseContentFile({
      path: 'vaults/test-room.yaml',
      source: `schemaVersion: 2
entries:
  - kind: vault
    id: vault.test-room
    name: Test room
    tags: [test]
    minDepth: 1
    maxDepth: 5
    rarity: common
    weight: 10
    maxPerFloor: 1
    margin: 1
    transforms: { rotations: [0, 180], reflectHorizontal: true }
    layout: ["#####", "#+m.#", "#####"]
    legend:
      "#": { terrain: wall }
      ".": { terrain: floor }
      "+": { terrain: floor, entrance: true }
      "m":
        terrain: floor
        slot: { id: monster-main, kind: monster, required: true, tags: [guard] }
`,
    });

    expect(entry).toMatchObject({
      kind: 'vault',
      layout: ['#####', '#+m.#', '#####'],
      entranceCount: 1,
      requiredSlotIds: ['monster-main'],
      legend: {
        '#': { terrain: 'wall', entrance: false, light: null, slot: null },
        m: {
          terrain: 'floor',
          entrance: false,
          light: null,
          slot: { id: 'monster-main', kind: 'monster', required: true, tags: ['guard'] },
        },
      },
    });
  });

  it('rejects unknown properties with a field path', () => {
    expect(() => parseContentFile({
      path: 'monsters/bad.yaml',
      source: `schemaVersion: 2
entries:
  - kind: monster
    id: monster.bad
    name: Bad
    glyph: b
    color: '#ffffff'
    minDepth: 1
    maxDepth: 1
    attributes: { might: 1, agility: 1, vitality: 1, wits: 1, resolve: 1 }
    health: 1
    speed: 100
    accuracy: 0
    defense: 0
    perception: 1
    damage: { count: 1, sides: 1, bonus: 0 }
    armor: 0
    resistances: { physical: 0, fire: 0, cold: 0, lightning: 0, poison: 0, arcane: 0 }
    disposition: hostile
    behaviorId: behavior.approach-and-attack
    runAppearanceChance: 1
    rarity: common
    surpriseProperty: true
`,
    })).toThrowError(ContentCompileError);
  });

  it('identifies a vault in structural numeric and fixture diagnostics', () => {
    let error: unknown;
    try {
      parseContentFile({
        path: 'vaults/bad-room.yaml',
        source: `schemaVersion: 2
entries:
  - kind: vault
    id: vault.bad-room
    name: Bad room
    minDepth: 0
    maxDepth: 5
    rarity: common
    weight: 10
    maxPerFloor: 1
    margin: 1
    transforms: { rotations: [0] }
    layout: ["+*"]
    legend:
      "+": { terrain: floor, entrance: true }
      "*":
        terrain: floor
        light:
          idSuffix: amber
          glyph: "*"
          presentationToken: fixture.lamp
          color: [255, 180, 64]
          radius: 0
          strength: 180
`,
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ContentCompileError);
    expect((error as ContentCompileError).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        file: 'vaults/bad-room.yaml',
        path: '$.entries.vault.bad-room.minDepth',
        message: expect.stringMatching(/expected number to be >0/i),
      }),
      expect.objectContaining({
        file: 'vaults/bad-room.yaml',
        path: '$.entries.vault.bad-room.legend.*.light.radius',
        message: expect.stringMatching(/expected number to be >0/i),
      }),
    ]));
  });

  it('keeps index-only structural paths when a raw vault ID is invalid', () => {
    let error: unknown;
    try {
      parseContentFile({
        path: 'vaults/invalid-id.yaml',
        source: `schemaVersion: 2
entries:
  - kind: vault
    id: "vault.Bad secret"
    name: Bad room
    minDepth: 0
    maxDepth: 5
    rarity: common
    weight: 10
    maxPerFloor: 1
    margin: 1
    transforms: { rotations: [0] }
    layout: ["+"]
    legend:
      "+": { terrain: floor, entrance: true }
`,
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ContentCompileError);
    expect((error as ContentCompileError).issues.map((issue) => issue.path)).toEqual(expect.arrayContaining([
      '$.entries.0.id',
      '$.entries.0.minDepth',
    ]));
    expect((error as Error).message).not.toContain('vault.Bad secret');
  });

  it('rejects aliases', () => {
    expect(() => parseContentFile({
      path: 'monsters/alias.yaml',
      source: 'schemaVersion: 2\nentries: &entries [*entries]\n',
    })).toThrow(/alias|YAML/i);
  });

  it('rejects custom tags with file context', () => {
    let error: unknown;
    try {
      parseContentFile({
        path: 'monsters/tagged.yaml',
        source: `schemaVersion: 2
entries: !unsafe
  - kind: monster
    id: monster.tagged
    name: Tagged
    glyph: t
    color: '#ffffff'
    ai: ai.skittish
    stats: { health: 1, attack: 1, defense: 0 }
`,
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ContentCompileError);
    expect((error as ContentCompileError).issues).toEqual([
      expect.objectContaining({
        file: 'monsters/tagged.yaml',
        path: '$',
        message: expect.stringMatching(/tag/i),
      }),
    ]);
  });
});
