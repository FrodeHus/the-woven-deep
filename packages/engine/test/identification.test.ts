import { describe, expect, it } from 'vitest';
import type { ItemContentEntry } from '@woven-deep/content';
import {
  allocateIdentificationMap, createDemoContentPack, createDemoRun, identifyItem, projectItem, stableJson,
  type ItemInstance, resolveCommand, createGeneratedDemoRun, validateContentBoundRun,
  decodeActiveRun, encodeActiveRun,
} from '../src/index.js';

function potion(id: string): ItemContentEntry {
  return { kind: 'item', id, name: id, glyph: '!', color: '#ffffff', tags: [], category: 'potion',
    stackLimit: 5, price: 1, rarity: 'common', minDepth: 0, maxDepth: 20, actionCost: 100,
    equipment: null, combat: null, light: null,
    identification: { mode: 'shuffled', groupId: 'group.potions', appearances: ['appearance.blue', 'appearance.red'] },
    effects: [] };
}

describe('per-run item identification', () => {
  it('allocates a stable bijection and advances only effects rng', () => {
    const base = createDemoContentPack();
    const content = { ...base, entries: [...base.entries, potion('item.heal'), potion('item.harm')] };
    const run = createDemoRun();
    const result = allocateIdentificationMap({ content, rng: run.rng });
    expect(new Set(Object.values(result.identification.appearanceByContentId)).size).toBe(2);
    expect(result.rng.encounters).toEqual(run.rng.encounters);
    expect(result.rng.effects).not.toEqual(run.rng.effects);
    expect(allocateIdentificationMap({ content, rng: run.rng })).toEqual(result);
  });

  it('allocates the identification map when a generated run is created', () => {
    const base = createDemoContentPack();
    const content = { ...base, entries: [...base.entries, potion('item.heal'), potion('item.harm')] };
    const { run } = createGeneratedDemoRun(content);
    expect(Object.keys(run.identification.appearanceByContentId)).toEqual(['item.harm', 'item.heal']);
    expect(run.rng.effects).not.toEqual(createDemoRun().rng.effects);
  });

  it('rejects incomplete, duplicated, and unknown saved appearance mappings', () => {
    const base = createDemoContentPack();
    const content = { ...base, entries: [...base.entries, potion('item.heal'), potion('item.harm')] };
    const valid = { ...createDemoRun(), identification: {
      appearanceByContentId: { 'item.harm': 'appearance.blue', 'item.heal': 'appearance.red' },
      knownAppearanceIds: ['appearance.red'],
    } };
    expect(() => validateContentBoundRun(valid, content)).not.toThrow();
    expect(() => validateContentBoundRun({ ...valid, identification: {
      ...valid.identification, appearanceByContentId: { 'item.heal': 'appearance.red' },
    } }, content)).toThrow(/identification map/i);
    expect(() => validateContentBoundRun({ ...valid, identification: {
      ...valid.identification, appearanceByContentId: { 'item.harm': 'appearance.red', 'item.heal': 'appearance.red' },
    } }, content)).toThrow(/one-to-one/i);
    expect(() => validateContentBoundRun({ ...valid, identification: {
      ...valid.identification, knownAppearanceIds: ['appearance.unknown'],
    } }, content)).toThrow(/known appearance/i);
  });

  it('identifies one enchanted instance without revealing its twin', () => {
    const base = createDemoRun();
    const first: ItemInstance = { itemId: 'item.sword.1', contentId: 'item.sword', quantity: 1, condition: 100,
      enchantment: { enchantmentId: 'enchantment.fire', modifiers: { meleeAccuracy: 1 } }, identified: false,
      charges: null, fuel: null, enabled: null, location: { type: 'backpack', actorId: 'hero.demo' } };
    const second = { ...first, itemId: 'item.sword.2' };
    const result = identifyItem({ run: { ...base, items: [first, second] }, itemId: first.itemId, eventId: 'event.identify' });
    expect(result.state.items.find((item) => item.itemId === first.itemId)!.identified).toBe(true);
    expect(result.state.items.find((item) => item.itemId === second.itemId)!.identified).toBe(false);
  });

  it('projects shuffled appearance without hidden content or enchantment', () => {
    const definition = potion('item.heal');
    const content = { ...createDemoContentPack(), entries: [...createDemoContentPack().entries, definition] };
    const item: ItemInstance = { itemId: 'item.potion.1', contentId: definition.id, quantity: 2, condition: 100,
      enchantment: { enchantmentId: 'enchantment.secret', modifiers: { defense: 1 } }, identified: false,
      charges: null, fuel: null, enabled: null, location: { type: 'backpack', actorId: 'hero.demo' } };
    const run = { ...createDemoRun(), items: [item], identification: {
      appearanceByContentId: { [definition.id]: 'appearance.blue' }, knownAppearanceIds: [],
    } };
    const json = stableJson(projectItem({ run, content, itemId: item.itemId }));
    expect(json).toContain('appearance.blue');
    expect(json).not.toContain(definition.id);
    expect(json).not.toContain('enchantment');
  });

  it('marks unidentified instance equipment as having unknown properties', () => {
    const definition = { ...potion('item.ring'), category: 'armor',
      identification: { mode: 'instance', groupId: null, appearances: ['appearance.plain-ring'] } } as ItemContentEntry;
    const content = { ...createDemoContentPack(), entries: [...createDemoContentPack().entries, definition] };
    const item: ItemInstance = { itemId: 'item.ring.1', contentId: definition.id, quantity: 1, condition: 100,
      enchantment: null, identified: false, charges: null, fuel: null, enabled: null,
      location: { type: 'backpack', actorId: 'hero.demo' } };
    const projected = projectItem({ run: { ...createDemoRun(), items: [item] }, content, itemId: item.itemId });
    expect(projected).toMatchObject({ contentId: definition.id, identified: false, unknownProperties: true });
  });

  it('reveals a shuffled appearance after applying effects but before consumption is published', () => {
    const heal = { ...potion('item.heal'), effects: [
      { effectId: 'effect.heal', parameters: { dice: { count: 1, sides: 1, bonus: 4 } }, requiresLivingTarget: true },
      { effectId: 'effect.item.consume', parameters: { quantity: 1 }, requiresLivingTarget: false },
    ] } as ItemContentEntry;
    const harm = potion('item.harm');
    const content = { ...createDemoContentPack(), entries: [...createDemoContentPack().entries, heal, harm] };
    const base = createDemoRun();
    const item: ItemInstance = { itemId: 'item.heal.1', contentId: heal.id, quantity: 1, condition: 100,
      enchantment: null, identified: false, charges: null, fuel: null, enabled: null,
      location: { type: 'backpack', actorId: 'hero.demo' } };
    const run = { ...base, actors: [{ ...base.actors[0]!, health: 10 }], items: [item], identification: {
      appearanceByContentId: { 'item.harm': 'appearance.blue', 'item.heal': 'appearance.red' }, knownAppearanceIds: [],
    } };
    const result = resolveCommand(run, { type: 'use-item', commandId: 'command.use-unknown', expectedRevision: 0,
      itemId: item.itemId, target: null }, { content });
    expect(result.events.map((event) => event.type)).toEqual([
      'item.used', 'actor.healed', 'identification.appearance-revealed', 'item.consumed',
    ]);
    expect(result.state.identification.knownAppearanceIds).toEqual(['appearance.red']);
    expect(decodeActiveRun(encodeActiveRun(result.state))).toEqual(result.state);
  });
});
