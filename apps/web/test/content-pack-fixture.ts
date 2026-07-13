import type { CompiledContentPack, ContentEntry, ContentKind } from '@woven-deep/content';

const attributes = { might: 3, agility: 8, vitality: 4, wits: 2, resolve: 2 } as const;
const resistances = { physical: 0, fire: 0, cold: 0, lightning: 0, poison: 0, arcane: 0 } as const;
const dice = { count: 1, sides: 4, bonus: 0 } as const;
const entries: readonly ContentEntry[] = [
  {
    kind: 'balance', id: 'balance.core', name: 'Core', tags: [], readinessThreshold: 100,
    normalActionCost: 100, speedMinimum: 25, speedMaximum: 400, energyMinimum: -10000,
    energyMaximum: 10000, attributeMinimum: 0, attributeMaximum: 30, hungerMaximum: 10000,
    hungerThresholds: { hungry: 3000, weak: 1000, starving: 0 }, starvationInterval: 500,
    starvationDamage: 1, recoveryInterval: 500, recoveryAmount: 1,
    recoveryByHungerStage: { sated: 100, hungry: 50, weak: 0, starving: 0 },
    hungerStageModifiers: { sated: {}, hungry: {}, weak: {}, starving: {} },
    formulas: { health: { base: 8 } }, actionCosts: { 'action.move': 100 },
  },
  {
    kind: 'condition', id: 'condition.stunned', name: 'Stunned', description: 'Cannot act', tags: [],
    color: '#d8c46a', duration: { mode: 'timed', default: 100, maximum: 500 },
    stacking: { mode: 'refresh', maximumStacks: 1 }, modifiersPerStack: {},
    traits: ['condition-trait.incapacitated'],
  },
  {
    kind: 'item', id: 'item.lantern', name: 'Lantern', tags: [], glyph: '¤', color: '#eeeeaa',
    minDepth: 1, maxDepth: 20, category: 'light', stackLimit: 1, price: 4, rarity: 'common',
    actionCost: 100, equipment: { slots: ['off-hand'], handedness: 'one-handed', reservedSlots: [] },
    combat: null, light: { color: [255, 200, 100], radius: 6, strength: 180, fuelCapacity: 1000,
      fuelPerTime: 1, warningThresholds: [100], fuelTags: ['lamp-oil'] },
    identification: { mode: 'known', groupId: null, appearances: [] }, effects: [],
  },
  {
    kind: 'loot-table', id: 'loot-table.basic', name: 'Basic loot', tags: [], rolls: 1,
    choices: [{ contentId: 'item.lantern', lootTableId: null, weight: 1, minimumQuantity: 1, maximumQuantity: 1 }],
  },
  {
    kind: 'monster', id: 'monster.rat', name: 'Rat', tags: [], glyph: 'r', color: '#aaaaaa',
    minDepth: 1, maxDepth: 5, attributes, health: 4, speed: 110, accuracy: 1, defense: 10,
    perception: 6, damage: dice, armor: 0, resistances, disposition: 'hostile',
    behaviorId: 'behavior.approach-and-attack', behaviorParameters: {}, runAppearanceChance: 1, rarity: 'common',
  },
  {
    kind: 'spell', id: 'spell.spark', name: 'Spark', tags: [], targetingId: 'target.actor', range: 5,
    actionCost: 100, effects: [{ effectId: 'effect.damage', parameters: { damageType: 'lightning', dice }, requiresLivingTarget: true }],
  },
  {
    kind: 'trap', id: 'trap.sparks', name: 'Spark trap', tags: [], glyph: '^', color: '#ffff00',
    targetingId: 'target.actor', discoveryDifficulty: 5, disarmDifficulty: 5, resetMode: 'once',
    effects: [{ effectId: 'effect.damage', parameters: { damageType: 'lightning', dice }, requiresLivingTarget: true }],
  },
  {
    kind: 'vault', id: 'vault.room', name: 'Room', tags: [], minDepth: 1, maxDepth: 20,
    rarity: 'common', weight: 1, maxPerFloor: 1, margin: 0,
    transforms: { rotations: [0], reflectHorizontal: false }, layout: ['+'],
    legend: { '+': { terrain: 'floor', entrance: true, light: null, slot: null } },
    entranceCount: 1, requiredSlotIds: [],
  },
];

export function contentPack(hash: string, kinds: readonly ContentKind[]): CompiledContentPack {
  return {
    schemaVersion: 2,
    hash,
    entries: entries.filter((entry) => kinds.includes(entry.kind)),
    generationReport: { foundationalCategories: [] },
  };
}
