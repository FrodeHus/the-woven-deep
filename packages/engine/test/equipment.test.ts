import { describe, expect, it } from 'vitest';
import type { CompiledContentPack, ItemContentEntry } from '@woven-deep/content';
import {
  createDemoContentPack, createDemoRun, deriveActorStats, equipItem, equipmentModifiers,
  equipmentPlan, itemLightSources, type ItemInstance, resolveCommand, encodeActiveRun,
  validateContentBoundRun,
  createUnknownKnowledge, isExplored,
} from '../src/index.js';

function definition(id: string, overrides: Partial<ItemContentEntry>): ItemContentEntry {
  return {
    kind: 'item', id, name: id, glyph: '/', color: '#ffffff', tags: [], category: 'weapon',
    stackLimit: 1, price: 1, rarity: 'common', minDepth: 0, maxDepth: 20, actionCost: 100,
    equipment: null, combat: null, light: null,
    identification: { mode: 'known', groupId: null, appearances: [] }, effects: [], ...overrides,
  };
}

function pack(...entries: ItemContentEntry[]): CompiledContentPack {
  const base = createDemoContentPack();
  return { ...base, entries: [...base.entries, ...entries] };
}

function item(itemId: string, contentId: string, location: ItemInstance['location']): ItemInstance {
  return { itemId, contentId, quantity: 1, condition: 100, enchantment: null, identified: true,
    charges: null, fuel: null, enabled: null, location };
}

describe('equipment planning and item lights', () => {
  const axe = definition('item.axe', {
    equipment: { slots: ['main-hand'], handedness: 'two-handed', reservedSlots: ['off-hand'] },
    combat: { accuracy: 0, defense: 0, armor: 0, damage: { count: 1, sides: 8, bonus: 0 }, range: 1, ammunitionTag: null },
  });
  const shield = definition('item.shield', {
    category: 'shield', equipment: { slots: ['off-hand'], handedness: 'one-handed', reservedSlots: [] },
    combat: { accuracy: 0, defense: 2, armor: 0, damage: null, range: 0, ammunitionTag: null },
  });

  it('reserves both hands and plans shield displacement before equipping', () => {
    const base = createDemoRun();
    const shieldItem = item('item.shield.1', shield.id, { type: 'equipped', actorId: 'hero.demo', slot: 'off-hand' });
    const axeItem = item('item.axe.1', axe.id, { type: 'backpack', actorId: 'hero.demo' });
    const hero = { ...base.actors[0]!, equipment: { ...base.actors[0]!.equipment, 'off-hand': shieldItem.itemId } };
    const run = { ...base, actors: [hero], items: [axeItem, shieldItem] };
    expect(equipmentPlan({ run, content: pack(axe, shield), actorId: 'hero.demo', itemId: axeItem.itemId, slot: 'main-hand' }))
      .toEqual({ ok: true, equip: [{ itemId: axeItem.itemId, slot: 'main-hand' }],
        unequip: [shieldItem.itemId], reservedSlots: ['main-hand', 'off-hand'] });
  });

  it('fails atomically when displaced equipment cannot fit in the backpack', () => {
    const base = createDemoRun();
    const fillerDefinition = definition('item.filler', { category: 'misc' });
    const swordDefinition = definition('item.sword', {
      equipment: { slots: ['main-hand'], handedness: 'one-handed', reservedSlots: [] },
    });
    const shieldItem = item('item.shield.1', shield.id, { type: 'equipped', actorId: 'hero.demo', slot: 'off-hand' });
    const swordItem = item('item.sword.1', swordDefinition.id, { type: 'equipped', actorId: 'hero.demo', slot: 'main-hand' });
    const axeItem = item('item.axe.1', axe.id, { type: 'backpack', actorId: 'hero.demo' });
    const filler = item('item.filler.1', fillerDefinition.id, { type: 'backpack', actorId: 'hero.demo' });
    const hero = { ...base.actors[0]!, equipment: { ...base.actors[0]!.equipment,
      'main-hand': swordItem.itemId, 'off-hand': shieldItem.itemId } };
    const run = { ...base, hero: { ...base.hero, backpackCapacity: 2 }, actors: [hero],
      items: [axeItem, filler, shieldItem, swordItem] };
    expect(equipItem({ run, content: pack(axe, shield, fillerDefinition, swordDefinition), actorId: 'hero.demo',
      itemId: axeItem.itemId, slot: 'main-hand' })).toEqual({ ok: false, reason: 'inventory.full' });
  });

  it('applies base and hidden enchantment modifiers only while equipped', () => {
    const base = createDemoRun();
    const shieldItem = { ...item('item.shield.1', shield.id, { type: 'equipped', actorId: 'hero.demo', slot: 'off-hand' }),
      identified: false, enchantment: { enchantmentId: 'enchantment.guard', modifiers: { defense: 1 } } };
    const hero = { ...base.actors[0]!, equipment: { ...base.actors[0]!.equipment, 'off-hand': shieldItem.itemId } };
    const content = pack(shield);
    const sources = equipmentModifiers({ run: { ...base, actors: [hero], items: [shieldItem] }, content, actorId: 'hero.demo' });
    const before = deriveActorStats({ attributes: hero.attributes,
      formulas: createDemoContentPack().entries.find((entry) => entry.kind === 'balance')!.formulas,
      equipmentModifiers: [], conditionModifiers: [] });
    const after = deriveActorStats({ attributes: hero.attributes,
      formulas: createDemoContentPack().entries.find((entry) => entry.kind === 'balance')!.formulas,
      equipmentModifiers: sources.map((source) => source.modifiers), conditionModifiers: [] });
    expect(after.defense - before.defense).toBe(3);
    expect(sources[0]!.publicModifiers).toEqual({ defense: 2 });
  });

  it('emits light only from enabled equipped or floor-placed fueled items', () => {
    const lantern = definition('item.lantern', {
      category: 'light', equipment: { slots: ['off-hand'], handedness: 'one-handed', reservedSlots: [] },
      light: { color: [255, 180, 80], radius: 6, strength: 180, fuelCapacity: 100,
        fuelPerTime: 1, warningThresholds: [20], fuelTags: ['oil'] },
    });
    const base = createDemoRun();
    const lit = { ...item('item.lantern.1', lantern.id, { type: 'equipped', actorId: 'hero.demo', slot: 'off-hand' }),
      fuel: 5, enabled: true };
    expect(itemLightSources({ run: { ...base, items: [lit] }, content: pack(lantern), floorId: 'floor.demo' })).toHaveLength(1);
    expect(itemLightSources({ run: { ...base, items: [{ ...lit, fuel: 0 }] }, content: pack(lantern), floorId: 'floor.demo' })).toEqual([]);
    expect(itemLightSources({ run: { ...base, items: [{ ...lit, location: { type: 'backpack', actorId: 'hero.demo' } }] },
      content: pack(lantern), floorId: 'floor.demo' })).toEqual([]);
  });

  it('rejects one-handed content that reserves the other hand', () => {
    const invalid = definition('item.invalid-hand', {
      equipment: { slots: ['main-hand'], handedness: 'one-handed', reservedSlots: ['off-hand'] },
    });
    expect(() => validateContentBoundRun(createDemoRun(), pack(invalid))).toThrow(/handedness.*reserve/i);
  });

  it('applies equip and unequip as timed saved commands', () => {
    const base = createDemoRun();
    const shieldItem = item('item.shield.1', shield.id, { type: 'backpack', actorId: 'hero.demo' });
    const content = pack(shield);
    const equipped = resolveCommand({ ...base, items: [shieldItem] }, {
      type: 'equip', commandId: 'command.equip', expectedRevision: 0,
      itemId: shieldItem.itemId, slot: 'off-hand',
    }, { content });
    expect(equipped.result).toMatchObject({ status: 'applied' });
    expect(equipped.state.actors[0]!.equipment['off-hand']).toBe(shieldItem.itemId);
    expect(() => encodeActiveRun(equipped.state)).not.toThrow();

    const unequipped = resolveCommand(equipped.state, {
      type: 'unequip', commandId: 'command.unequip', expectedRevision: 1, slot: 'off-hand',
    }, { content });
    expect(unequipped.result).toMatchObject({ status: 'applied' });
    expect(unequipped.state.items[0]!.location).toEqual({ type: 'backpack', actorId: 'hero.demo' });
    expect(() => encodeActiveRun(unequipped.state)).not.toThrow();
  });

  it('toggles and refuels item-backed lights through saved commands', () => {
    const lantern = definition('item.lantern', {
      category: 'light', equipment: { slots: ['off-hand'], handedness: 'one-handed', reservedSlots: [] },
      light: { color: [255, 180, 80], radius: 6, strength: 180, fuelCapacity: 100,
        fuelPerTime: 1, warningThresholds: [20], fuelTags: ['oil'] },
    });
    const oil = definition('item.oil', { category: 'fuel', stackLimit: 10, tags: ['oil'] });
    const base = createDemoRun();
    const lanternItem = { ...item('item.lantern.1', lantern.id,
      { type: 'equipped', actorId: 'hero.demo', slot: 'off-hand' }), fuel: 0, enabled: false };
    const oilItem = { ...item('item.oil.1', oil.id, { type: 'backpack', actorId: 'hero.demo' }), quantity: 3 };
    const hero = { ...base.actors[0]!, equipment: { ...base.actors[0]!.equipment, 'off-hand': lanternItem.itemId } };
    const content = pack(lantern, oil);
    const run = { ...base, actors: [hero], items: [lanternItem, oilItem] };
    const refueled = resolveCommand(run, { type: 'refuel', commandId: 'command.refuel', expectedRevision: 0,
      itemId: lanternItem.itemId, fuelItemId: oilItem.itemId, quantity: 3 }, { content });
    expect(refueled.result).toMatchObject({ status: 'applied' });
    expect(refueled.state.items.find((entry) => entry.itemId === lanternItem.itemId)!.fuel).toBe(3);
    expect(refueled.state.items.some((entry) => entry.itemId === oilItem.itemId)).toBe(false);

    const toggled = resolveCommand(refueled.state, { type: 'toggle-light', commandId: 'command.light-on',
      expectedRevision: 1, itemId: lanternItem.itemId, enabled: true }, { content });
    expect(toggled.result).toMatchObject({ status: 'applied' });
    expect(itemLightSources({ run: toggled.state, content, floorId: 'floor.demo' })).toHaveLength(1);
    expect(() => encodeActiveRun(toggled.state)).not.toThrow();
  });

  it('refreshes dark-floor perception from a newly enabled equipped light', () => {
    const lantern = definition('item.lantern-dark', {
      category: 'light', equipment: { slots: ['off-hand'], handedness: 'one-handed', reservedSlots: [] },
      light: { color: [255, 180, 80], radius: 3, strength: 180, fuelCapacity: 100,
        fuelPerTime: 1, warningThresholds: [20], fuelTags: ['oil'] },
    });
    const base = createDemoRun();
    const lanternItem = { ...item('item.lantern-dark.1', lantern.id,
      { type: 'equipped', actorId: 'hero.demo', slot: 'off-hand' }), fuel: 5, enabled: false };
    const hero = { ...base.actors[0]!, equipment: { ...base.actors[0]!.equipment, 'off-hand': lanternItem.itemId } };
    const floor = { ...base.floors[0]!, ambient: { color: [0, 0, 0] as const, strength: 0 },
      knowledge: createUnknownKnowledge(base.floors[0]!.tiles.length) };
    const result = resolveCommand({ ...base, actors: [hero], items: [lanternItem], floors: [floor] }, {
      type: 'toggle-light', commandId: 'command.light-dark', expectedRevision: 0,
      itemId: lanternItem.itemId, enabled: true,
    }, { content: pack(lantern) });
    expect(result.result).toMatchObject({ status: 'applied' });
    expect(isExplored(result.state.floors[0]!.knowledge, hero.y * floor.width + hero.x)).toBe(true);
  });
});
