import { describe, expect, it } from 'vitest';
import { ContentCompileError, parseContentFile } from '../src/compiler/index.js';
import { encounterModels } from '../src/compiler/schema.js';

describe('parseContentFile', () => {
  it('publishes and parses strict schema-v4 NPC content', () => {
    expect(encounterModels).toContain('merchant');
    const validNpcYaml = `schemaVersion: 5
entries:
  - kind: npc
    id: npc.travelling-lampwright
    name: Travelling Lampwright
    tags: [merchant]
    glyph: L
    color: '#ffd166'
    factionId: npc-faction.lampwrights
    attributes: { might: 8, agility: 9, vitality: 10, wits: 12, resolve: 11 }
    health: 20
    speed: 100
    perception: 12
    accuracy: 8
    defense: 10
    damage: { count: 1, sides: 4, bonus: 0 }
    armor: 1
    resistances: { physical: 0, fire: 10, cold: 0, lightning: 0, poison: 0, arcane: 0 }
    disposition: neutral
    behaviorId: npc-behavior.travelling-merchant
    behaviorParameters: {}
    selfPreservationThresholdBps: 3500
`;
    expect(parseContentFile({ path: 'npcs/lampwright.yaml', source: validNpcYaml })[0]).toMatchObject({
      kind: 'npc', factionId: 'npc-faction.lampwrights', disposition: 'neutral',
      behaviorId: 'npc-behavior.travelling-merchant', selfPreservationThresholdBps: 3500,
    });
    for (const replacement of [
      'disposition: hostile', 'health: 0', 'selfPreservationThresholdBps: 0',
      'factionId: lampwrights', 'unknownField: true',
    ]) {
      const source = replacement.startsWith('disposition:') ? validNpcYaml.replace('disposition: neutral', replacement)
        : replacement.startsWith('health:') ? validNpcYaml.replace('health: 20', replacement)
          : replacement.startsWith('selfPreservation') ? validNpcYaml.replace('selfPreservationThresholdBps: 3500', replacement)
            : replacement.startsWith('factionId:') ? validNpcYaml.replace('factionId: npc-faction.lampwrights', replacement)
              : validNpcYaml.replace('    selfPreservationThresholdBps: 3500', `    selfPreservationThresholdBps: 3500\n    ${replacement}`);
      expect(() => parseContentFile({ path: 'npcs/invalid.yaml', source })).toThrow();
    }
  });

  it('rejects schema v4 after the schema-v5 upgrade', () => {
    expect(() => parseContentFile({ path: 'legacy.yaml', source: 'schemaVersion: 4\nentries: []\n' }))
      .toThrow(/expected 5/i);
  });
  it('rejects source schema v2 with a stable version diagnostic', () => {
    expect(() => parseContentFile({
      path: 'legacy.yaml',
      source: 'schemaVersion: 2\nentries: []\n',
    })).toThrow(/legacy\.yaml.*schemaVersion.*expected 5/i);
  });

  it('publishes and parses strict schema-v5 achievement content', () => {
    const validAchievementYaml = `schemaVersion: 5
entries:
  - kind: achievement
    id: achievement.defeated-the-deeps-champion
    name: Defeated the Deep's Champion
    tags: [fallen-hero, prestige]
    description: Defeat the Deep's Champion for the first time.
    criteriaId: first-champion-defeat
`;
    expect(parseContentFile({ path: 'achievements/first-defeats.yaml', source: validAchievementYaml })[0]).toMatchObject({
      kind: 'achievement', criteriaId: 'first-champion-defeat',
      name: "Defeated the Deep's Champion",
    });
    for (const [label, source] of [
      ['unknown field', validAchievementYaml.replace('    criteriaId: first-champion-defeat',
        '    criteriaId: first-champion-defeat\n    reward: 100')],
      ['unknown criteria', validAchievementYaml.replace('criteriaId: first-champion-defeat', 'criteriaId: first-boss-defeat')],
      ['empty description', validAchievementYaml.replace("description: Defeat the Deep's Champion for the first time.", 'description: " "')],
      ['missing criteria', validAchievementYaml.replace('    criteriaId: first-champion-defeat\n', '')],
    ] as const) {
      expect(() => parseContentFile({ path: 'achievements/invalid.yaml', source }), `expected rejection: ${label}`).toThrow();
    }
  });

  it('parses strict score coefficients on the balance entry', () => {
    const validBalanceYaml = `schemaVersion: 5
entries:
  - { kind: balance, startingCurrency: 40, id: balance.core, name: Core, tags: [], readinessThreshold: 100, normalActionCost: 100, speedMinimum: 25, speedMaximum: 400, energyMinimum: -10000, energyMaximum: 10000, attributeMinimum: 0, attributeMaximum: 30, hungerMaximum: 10000, hungerThresholds: { hungry: 3000, weak: 1000, starving: 0 }, starvationInterval: 500, starvationDamage: 1, recoveryInterval: 500, recoveryAmount: 1, restMaximumDuration: 5000, recoveryByHungerStage: { sated: 100, hungry: 50, weak: 0, starving: 0 }, hungerStageModifiers: { sated: {}, hungry: {}, weak: {}, starving: {} }, formulas: { health: { base: 8, vitality: 2 } }, actionCosts: { action.move: 100 }, score: { depthCoefficient: 100, bossDefeatCoefficient: 250, threatCoefficient: 5, discoveryCoefficient: 25, completionBonus: { died: 0, refused: 400, became-heart: 800, broke-cycle: 1500 }, turnEfficiencyBudget: 500, turnEfficiencyDecayInterval: 200 } }
`;
    expect(parseContentFile({ path: 'balance.yaml', source: validBalanceYaml })[0]).toMatchObject({
      score: {
        depthCoefficient: 100, bossDefeatCoefficient: 250, threatCoefficient: 5,
        discoveryCoefficient: 25,
        completionBonus: { died: 0, refused: 400, 'became-heart': 800, 'broke-cycle': 1500 },
        turnEfficiencyBudget: 500, turnEfficiencyDecayInterval: 200,
      },
    });
    for (const [label, needle, substitute] of [
      ['negative coefficient', 'depthCoefficient: 100', 'depthCoefficient: -1'],
      ['unsafe coefficient', 'bossDefeatCoefficient: 250', `bossDefeatCoefficient: ${Number.MAX_SAFE_INTEGER + 1}`],
      ['fractional coefficient', 'threatCoefficient: 5', 'threatCoefficient: 0.5'],
      ['negative completion bonus', 'refused: 400', 'refused: -400'],
      ['missing completion bonus key', 'became-heart: 800, ', ''],
      ['unknown completion bonus key', 'died: 0', 'died: 0, fled: 1'],
      ['zero decay interval', 'turnEfficiencyDecayInterval: 200', 'turnEfficiencyDecayInterval: 0'],
      ['unknown score field', 'turnEfficiencyBudget: 500', 'turnEfficiencyBudget: 500, styleBonus: 1'],
      ['missing score block', ', score: { depthCoefficient: 100, bossDefeatCoefficient: 250, threatCoefficient: 5, discoveryCoefficient: 25, completionBonus: { died: 0, refused: 400, became-heart: 800, broke-cycle: 1500 }, turnEfficiencyBudget: 500, turnEfficiencyDecayInterval: 200 }', ''],
    ] as const) {
      const source = validBalanceYaml.replace(needle, substitute);
      expect(source, `replacement applied: ${label}`).not.toBe(validBalanceYaml);
      expect(() => parseContentFile({ path: 'balance.yaml', source }), `expected rejection: ${label}`).toThrow();
    }
  });

  it('requires a non-negative safe-integer threat on every monster', () => {
    const validMonsterYaml = `schemaVersion: 5
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
    threat: 1
    rarity: common
`;
    expect(parseContentFile({ path: 'monsters/rat.yaml', source: validMonsterYaml })[0]).toMatchObject({ threat: 1 });
    for (const [label, replacement] of [
      ['negative threat', 'threat: -1'],
      ['fractional threat', 'threat: 0.5'],
      ['unsafe threat', `threat: ${Number.MAX_SAFE_INTEGER + 1}`],
      ['missing threat', ''],
    ] as const) {
      const source = validMonsterYaml.replace('    threat: 1\n', replacement === '' ? '' : `    ${replacement}\n`);
      expect(() => parseContentFile({ path: 'monsters/invalid.yaml', source }), `expected rejection: ${label}`)
        .toThrow(/threat/);
    }
  });

  it('keeps appearance probability on encounters and rejects it on reusable monsters', () => {
    const source = `schemaVersion: 5
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
    threat: 1
    disposition: hostile
    behaviorId: behavior.approach-and-attack
    rarity: common
  - kind: encounter
    id: encounter.lone-rats
    name: Lone rats
    tags: [animal]
    model: individual
    minDepth: 1
    maxDepth: 5
    environmentTags: []
    requiredVaultTags: []
    weight: 10
    rarity: common
    runAppearanceChance: 1
    discoveryProtectionIncrement: 0
    discoveryProtectionCap: 1
    maximumInstancesPerRun: 3
    placement: { minimumStairDistance: 3, minimumObjectiveDistance: 3, maximumMemberDistance: 2, allowedTerrainTags: [floor], requiresVaultSlot: false, failureMode: optional }
    intentPresentation: { visible: true }
    definition: { monsterId: monster.cave-rat, minimumQuantity: 1, maximumQuantity: 2 }
`;
    expect(parseContentFile({ path: 'encounters/rats.yaml', source }).map((entry) => entry.kind))
      .toEqual(['monster', 'encounter']);
    expect(() => parseContentFile({
      path: 'monsters/bad.yaml',
      source: source.replace('behaviorId: behavior.approach-and-attack\n    rarity',
        'behaviorId: behavior.approach-and-attack\n    runAppearanceChance: 1\n    rarity'),
    })).toThrow(/runAppearanceChance/i);
  });

  it('parses strict group, swarm, boss, and champion-template definitions', () => {
    const source = `schemaVersion: 5
entries:
  - { kind: encounter, id: encounter.patrol, name: Patrol, tags: [], model: group, minDepth: 1, maxDepth: 4, environmentTags: [], requiredVaultTags: [], weight: 5, rarity: uncommon, runAppearanceChance: 0.5, discoveryProtectionIncrement: 0.1, discoveryProtectionCap: 0.8, maximumInstancesPerRun: 2, placement: { minimumStairDistance: 3, minimumObjectiveDistance: 3, maximumMemberDistance: 4, allowedTerrainTags: [floor], requiresVaultSlot: false, failureMode: optional }, intentPresentation: { visible: true }, definition: { roles: [{ roleId: guard, monsterId: monster.guard, minimumQuantity: 2, maximumQuantity: 3, formationPreference: front, behaviorParameters: {} }], formation: line, communicationRadius: 4, leaderChance: 0.5, leaderRoleId: guard, leaderAccentColor: '#ffcc44', leaderAlternateGlyph: null, coordinationModifiers: { accuracy: 1, defense: 1, damage: 0 }, leaderDeathResponse: weaken, responseParameters: {}, supernaturalBond: false, collapseRewards: none } }
  - { kind: encounter, id: encounter.nest, name: Nest, tags: [], model: swarm, minDepth: 1, maxDepth: 6, environmentTags: [], requiredVaultTags: [], weight: 4, rarity: uncommon, runAppearanceChance: 0.4, discoveryProtectionIncrement: 0.1, discoveryProtectionCap: 0.8, maximumInstancesPerRun: 2, placement: { minimumStairDistance: 4, minimumObjectiveDistance: 4, maximumMemberDistance: 3, allowedTerrainTags: [floor], requiresVaultSlot: false, failureMode: optional }, intentPresentation: { visible: true }, definition: { sourceMonsterId: monster.nest, spawnRoles: [{ roleId: rat, monsterId: monster.rat, weight: 1 }], spawnInterval: 200, minimumSpawnQuantity: 1, maximumSpawnQuantity: 2, placementRadius: 3, allowedTerrainTags: [floor], maximumLivingChildren: 8, maximumLivingMembers: 9, maximumFloorActors: 20, sourceDestructionResponse: flee, responseParameters: {} } }
  - { kind: encounter, id: encounter.warden, name: Warden, tags: [], model: boss, minDepth: 5, maxDepth: 5, environmentTags: [], requiredVaultTags: [boss-arena], weight: 1, rarity: legendary, runAppearanceChance: 0.08, discoveryProtectionIncrement: 0.03, discoveryProtectionCap: 0.35, maximumInstancesPerRun: 1, placement: { minimumStairDistance: 5, minimumObjectiveDistance: 5, maximumMemberDistance: 0, allowedTerrainTags: [floor], requiresVaultSlot: true, failureMode: required }, intentPresentation: { visible: true }, definition: { monsterId: monster.warden, phases: [{ phaseId: enraged, healthThresholdPercent: 50, behaviorId: behavior.approach-and-attack, behaviorParameters: {}, modifiers: { accuracy: 2, defense: 0, damage: 2 }, effects: [] }], recoveryPerWorldTime: 0.01, recoveryCapPercent: 25, uniqueItemId: item.warden-key, enhancedLootTableId: loot-table.warden, vaultTags: [boss-arena] } }
  - { kind: fallen-champion-template, id: fallen-champion-template.core, name: Deep's Champion, tags: [], fallbackMonsterId: monster.guard, fallbackItemId: item.fallback-relic, minimumHealth: 10, maximumHealth: 200, attributeMaximum: 30, damageMaximum: 30, abilityLimit: 3, echoAppearanceChance: 0.08, maximumEchoesPerRun: 2, echoHealthPercent: 65, echoDamagePercent: 70, echoDefensePercent: 80, echoAbilityLimit: 2, echoLootTableId: loot-table.echo, heirloomSelection: { rarityWeights: { common: 1, uncommon: 3, rare: 8, legendary: 16 }, qualityRankBonus: 2 } }
`;
    expect(parseContentFile({ path: 'population.yaml', source }).map((entry) => entry.kind))
      .toEqual(['encounter', 'encounter', 'encounter', 'fallen-champion-template']);
  });

  it('applies defaults to a strict monster entry', () => {
    const [entry] = parseContentFile({
      path: 'monsters/rat.yaml',
      source: `schemaVersion: 5
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
    threat: 1
    disposition: hostile
    behaviorId: behavior.approach-and-attack
    rarity: common
`,
    });

    expect(entry).toMatchObject({
      id: 'monster.cave-rat',
      tags: [],
    });
  });

  it('parses strict timed and permanent condition definitions', () => {
    const entries = parseContentFile({
      path: 'conditions/control.yaml',
      source: `schemaVersion: 5
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
    const base = `schemaVersion: 5
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
      source: `schemaVersion: 5
entries:
  - { kind: item, id: item.sword, name: Sword, glyph: "/", color: "#dddddd", tags: [], minDepth: 1, maxDepth: 20, category: weapon, stackLimit: 1, price: 20, rarity: common, actionCost: 100, equipment: { slots: [main-hand], handedness: one-handed, reservedSlots: [] }, combat: { accuracy: 1, defense: 0, armor: 0, damage: { count: 1, sides: 6, bonus: 0 }, range: 1, ammunitionTag: null }, light: null, identification: { mode: known, poolId: null }, effects: [] }
  - { kind: spell, id: spell.mend, name: Mend, tags: [], targetingId: target.self, range: 0, actionCost: 100, effects: [{ effectId: effect.heal, parameters: { dice: { count: 1, sides: 4, bonus: 0 } } }] }
  - { kind: trap, id: trap.dart, name: Dart trap, glyph: "^", color: "#aaaaaa", tags: [], targetingId: target.actor, discoveryDifficulty: 5, disarmDifficulty: 6, disarmOutcomes: { failure: safe, criticalFailure: trigger, toolDamage: 10 }, resetMode: once, effects: [{ effectId: effect.damage, parameters: { damageType: physical, dice: { count: 1, sides: 4, bonus: 0 } } }] }
  - { kind: loot-table, id: loot-table.basic, name: Basic loot, tags: [], rolls: 1, choices: [{ contentId: item.sword, lootTableId: null, weight: 1, minimumQuantity: 1, maximumQuantity: 1 }] }
  - { kind: balance, startingCurrency: 40, id: balance.core, name: Core, tags: [], readinessThreshold: 100, normalActionCost: 100, speedMinimum: 25, speedMaximum: 400, energyMinimum: -10000, energyMaximum: 10000, attributeMinimum: 0, attributeMaximum: 30, hungerMaximum: 10000, hungerThresholds: { hungry: 3000, weak: 1000, starving: 0 }, starvationInterval: 500, starvationDamage: 1, recoveryInterval: 500, recoveryAmount: 1, restMaximumDuration: 5000, recoveryByHungerStage: { sated: 100, hungry: 50, weak: 0, starving: 0 }, hungerStageModifiers: { sated: {}, hungry: {}, weak: {}, starving: {} }, formulas: { health: { base: 8, vitality: 2 } }, actionCosts: { action.move: 100 }, score: { depthCoefficient: 100, bossDefeatCoefficient: 250, threatCoefficient: 5, discoveryCoefficient: 25, completionBonus: { died: 0, refused: 400, became-heart: 800, broke-cycle: 1500 }, turnEfficiencyBudget: 500, turnEfficiencyDecayInterval: 200 } }
`,
    });

    expect(entries.map((entry) => entry.kind)).toEqual(['item', 'spell', 'trap', 'loot-table', 'balance']);
    expect(entries[1]).toMatchObject({ effects: [{ requiresLivingTarget: false }] });
  });

  it.each([
    ['dice count', 'damage: { count: 0, sides: 3, bonus: 0 }', /entries\.monster\.cave-rat\.damage\.count/],
    ['non-positive speed', 'speed: 100', /entries\.monster\.cave-rat\.speed/],
  ])('rejects invalid %s with a stable path', (_name, replacement, path) => {
    const source = `schemaVersion: 5
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
    threat: 1
    disposition: hostile
    behaviorId: behavior.approach-and-attack
    rarity: common
`.replace(replacement === 'speed: 100' ? replacement : 'damage: { count: 1, sides: 3, bonus: 0 }', replacement === 'speed: 100' ? 'speed: 0' : replacement);
    expect(() => parseContentFile({ path: 'invalid.yaml', source })).toThrow(path);
  });

  it('rejects unknown targeting rules with a stable path', () => {
    expect(() => parseContentFile({
      path: 'spell.yaml',
      source: 'schemaVersion: 5\nentries: [{kind: spell, id: spell.bad, name: Bad, tags: [], targetingId: target.unknown, range: 1, actionCost: 100, effects: [{effectId: effect.heal, parameters: {dice: {count: 1, sides: 4, bonus: 0}}}]}]\n',
    })).toThrow(/entries\.spell\.bad\.targetingId/);
  });

  it('rejects a negative action cost with a stable path', () => {
    expect(() => parseContentFile({
      path: 'spell.yaml',
      source: 'schemaVersion: 5\nentries: [{kind: spell, id: spell.bad, name: Bad, tags: [], targetingId: target.self, range: 0, actionCost: -1, effects: [{effectId: effect.heal, parameters: {dice: {count: 1, sides: 4, bonus: 0}}}]}]\n',
    })).toThrow(/entries\.spell\.bad\.actionCost/);
  });

  it('materializes defaults and derived metadata for a strict vault entry', () => {
    const [entry] = parseContentFile({
      path: 'vaults/test-room.yaml',
      source: `schemaVersion: 5
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
      source: `schemaVersion: 5
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
    threat: 1
    disposition: hostile
    behaviorId: behavior.approach-and-attack
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
        source: `schemaVersion: 5
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
        source: `schemaVersion: 5
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
      source: 'schemaVersion: 5\nentries: &entries [*entries]\n',
    })).toThrow(/alias|YAML/i);
  });

  it('rejects custom tags with file context', () => {
    let error: unknown;
    try {
      parseContentFile({
        path: 'monsters/tagged.yaml',
        source: `schemaVersion: 5
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
