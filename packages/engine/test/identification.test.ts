import { describe, expect, it } from 'vitest';
import type { IdentificationPoolContentEntry, ItemContentEntry } from '@woven-deep/content';
import {
  allocateIdentificationMap, createDemoContentPack, createDemoRun, identifyItem, identifyItemCompletely,
  projectItem, stableJson,
  type ItemInstance, resolveCommand, createGeneratedDemoRun, validateContentBoundRun,
  decodeActiveRun, encodeActiveRun, unidentifiedPresentation,
} from '../src/index.js';

function potion(id: string): ItemContentEntry {
  return { kind: 'item', id, name: id, glyph: '!', color: '#ffffff', tags: [], category: 'potion',
    stackLimit: 5, price: 1, rarity: 'common', minDepth: 0, maxDepth: 20, actionCost: 100,
    equipment: null, combat: null, light: null,
    identification: { mode: 'shuffled', poolId: 'identification-pool.potions' },
    effects: [] };
}

function pool(category: 'potion' | 'ring' = 'potion'): IdentificationPoolContentEntry {
  return { kind: 'identification-pool', id: `identification-pool.${category}s`,
    name: `${category} unidentified names`, tags: [], category,
    verbs: ['Bubbling', 'Dancing', 'Smoking'], nouns: ['flask', 'phial', 'vial'],
    visuals: [{ id: 'visual.blue', glyph: '!', color: '#4466aa' },
      { id: 'visual.red', glyph: '¡', color: '#aa4455' }] };
}

function contentWith(...items: readonly ItemContentEntry[]) {
  const base = createDemoContentPack();
  const pools = [...new Set(items.map((item) => item.category))]
    .map((category) => pool(category === 'ring' ? 'ring' : 'potion'));
  return { ...base, entries: [...base.entries, ...pools, ...items] };
}

describe('per-run item identification', () => {
  it('allocates a stable bijection and advances only effects rng', () => {
    const content = contentWith(potion('item.heal'), potion('item.harm'));
    const run = createDemoRun();
    const result = allocateIdentificationMap({ content, rng: run.rng });
    expect(new Set(Object.values(result.identification.appearanceByContentId)).size).toBe(2);
    const names = Object.values(result.identification.appearanceByContentId)
      .map((appearanceId) => unidentifiedPresentation({ content, appearanceId }).name);
    expect(new Set(names).size).toBe(names.length);
    expect(result.rng.encounters).toEqual(run.rng.encounters);
    expect(result.rng.effects).not.toEqual(run.rng.effects);
    expect(allocateIdentificationMap({ content, rng: run.rng })).toEqual(result);
    const alternate = allocateIdentificationMap({ content, rng: {
      ...run.rng, effects: [11, 22, 33, 44],
    } });
    expect(Object.values(alternate.identification.appearanceByContentId))
      .not.toEqual(Object.values(result.identification.appearanceByContentId));
  });

  it('allocates the identification map when a generated run is created', () => {
    const content = contentWith(potion('item.heal'), potion('item.harm'));
    const { run } = createGeneratedDemoRun(content);
    expect(Object.keys(run.identification.appearanceByContentId)).toEqual(['item.harm', 'item.heal']);
    expect(run.rng.effects).not.toEqual(createDemoRun().rng.effects);
  });

  it('rejects incomplete, duplicated, and unknown saved appearance mappings', () => {
    const content = contentWith(potion('item.heal'), potion('item.harm'));
    const allocated = allocateIdentificationMap({ content, rng: createDemoRun().rng }).identification;
    const [harmAppearance, healAppearance] = ['item.harm', 'item.heal']
      .map((id) => allocated.appearanceByContentId[id]!);
    const valid = { ...createDemoRun(), identification: { ...allocated, knownAppearanceIds: [healAppearance] } };
    expect(() => validateContentBoundRun(valid, content)).not.toThrow();
    expect(() => validateContentBoundRun({ ...valid, identification: {
      ...valid.identification, appearanceByContentId: { 'item.heal': healAppearance },
    } }, content)).toThrow(/identification map/i);
    expect(() => validateContentBoundRun({ ...valid, identification: {
      ...valid.identification, appearanceByContentId: { 'item.harm': harmAppearance, 'item.heal': harmAppearance },
    } }, content)).toThrow(/unique names/i);
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

  it('completely identifies a shuffled item revealing the appearance before the instance', () => {
    const definition = potion('item.heal');
    const content = contentWith(definition, potion('item.harm'));
    const item: ItemInstance = { itemId: 'item.potion.1', contentId: definition.id, quantity: 1, condition: 100,
      enchantment: null, identified: false, charges: null, fuel: null, enabled: null,
      location: { type: 'backpack', actorId: 'hero.demo' } };
    const identification = allocateIdentificationMap({ content, rng: createDemoRun().rng }).identification;
    const run = { ...createDemoRun(), items: [item], identification };
    const result = identifyItemCompletely({ run, content, itemId: item.itemId, eventId: 'event.identify' });
    expect(result.events).toEqual([
      { type: 'identification.appearance-revealed', eventId: 'event.identify',
        appearanceId: identification.appearanceByContentId[definition.id], contentId: definition.id },
      { type: 'item.identified', eventId: 'event.identify', itemId: item.itemId },
    ]);
    expect(result.state.identification.knownAppearanceIds)
      .toEqual([identification.appearanceByContentId[definition.id]]);
    expect(result.state.items[0]!.identified).toBe(true);
  });

  it('completely identifies an instance item without touching the shared appearance map', () => {
    const definition = { ...potion('item.ring'), category: 'ring',
      identification: { mode: 'instance', poolId: 'identification-pool.rings' } } as ItemContentEntry;
    const content = contentWith(definition);
    const item: ItemInstance = { itemId: 'item.ring.1', contentId: definition.id, quantity: 1, condition: 100,
      enchantment: null, identified: false, charges: null, fuel: null, enabled: null,
      location: { type: 'backpack', actorId: 'hero.demo' } };
    const identification = allocateIdentificationMap({ content, rng: createDemoRun().rng }).identification;
    const run = { ...createDemoRun(), items: [item], identification };
    const result = identifyItemCompletely({ run, content, itemId: item.itemId, eventId: 'event.identify' });
    expect(result.events).toEqual([
      { type: 'item.identified', eventId: 'event.identify', itemId: item.itemId },
    ]);
    expect(result.state.identification.knownAppearanceIds).toEqual([]);
    expect(result.state.items[0]!.identified).toBe(true);
    expect(() => validateContentBoundRun(result.state, content)).not.toThrow();
  });

  it('completely identifying an identified item is a no-op', () => {
    const definition = potion('item.heal');
    const content = contentWith(definition, potion('item.harm'));
    const identification = allocateIdentificationMap({ content, rng: createDemoRun().rng }).identification;
    const item: ItemInstance = { itemId: 'item.potion.1', contentId: definition.id, quantity: 1, condition: 100,
      enchantment: null, identified: true, charges: null, fuel: null, enabled: null,
      location: { type: 'backpack', actorId: 'hero.demo' } };
    const run = { ...createDemoRun(), items: [item], identification: {
      ...identification, knownAppearanceIds: [identification.appearanceByContentId[definition.id]!] } };
    const result = identifyItemCompletely({ run, content, itemId: item.itemId, eventId: 'event.identify' });
    expect(result.events).toEqual([]);
    expect(result.state).toBe(run);
  });

  it('projects shuffled appearance without hidden content or enchantment', () => {
    const definition = potion('item.heal');
    const content = contentWith(definition);
    const item: ItemInstance = { itemId: 'item.potion.1', contentId: definition.id, quantity: 2, condition: 100,
      enchantment: { enchantmentId: 'enchantment.secret', modifiers: { defense: 1 } }, identified: false,
      charges: null, fuel: null, enabled: null, location: { type: 'backpack', actorId: 'hero.demo' } };
    const identification = allocateIdentificationMap({ content, rng: createDemoRun().rng }).identification;
    const run = { ...createDemoRun(), items: [item], identification };
    const projected = projectItem({ run, content, itemId: item.itemId });
    const json = stableJson(projected);
    expect(projected).toMatchObject({ name: expect.stringMatching(/^(Bubbling|Dancing|Smoking) (flask|phial|vial)$/),
      glyph: expect.any(String), color: expect.stringMatching(/^#[0-9a-f]{6}$/) });
    expect(json).not.toContain(definition.id);
    expect(json).not.toContain('enchantment');
  });

  it('projects an instance-identified item under its random run name until identified', () => {
    const definition = { ...potion('item.ring'), category: 'ring',
      identification: { mode: 'instance', poolId: 'identification-pool.rings' } } as ItemContentEntry;
    const content = contentWith(definition);
    const item: ItemInstance = { itemId: 'item.ring.1', contentId: definition.id, quantity: 1, condition: 100,
      enchantment: null, identified: false, charges: null, fuel: null, enabled: null,
      location: { type: 'backpack', actorId: 'hero.demo' } };
    const identification = allocateIdentificationMap({ content, rng: createDemoRun().rng }).identification;
    const projected = projectItem({ run: { ...createDemoRun(), items: [item], identification }, content, itemId: item.itemId });
    expect(projected).toMatchObject({ name: expect.any(String), identified: false });
    expect(projected).not.toHaveProperty('contentId');
    expect(() => validateContentBoundRun({ ...createDemoRun(), items: [item], identification: {
      ...identification, knownAppearanceIds: [identification.appearanceByContentId[definition.id]!],
    } }, content)).toThrow(/known appearance/i);
  });

  it('reveals a shuffled appearance after applying effects but before consumption is published', () => {
    const heal = { ...potion('item.heal'), effects: [
      { effectId: 'effect.heal', parameters: { dice: { count: 1, sides: 1, bonus: 4 } }, requiresLivingTarget: true },
      { effectId: 'effect.item.consume', parameters: { quantity: 1 }, requiresLivingTarget: false },
    ] } as ItemContentEntry;
    const harm = potion('item.harm');
    const content = contentWith(heal, harm);
    const base = createDemoRun();
    const item: ItemInstance = { itemId: 'item.heal.1', contentId: heal.id, quantity: 1, condition: 100,
      enchantment: null, identified: false, charges: null, fuel: null, enabled: null,
      location: { type: 'backpack', actorId: 'hero.demo' } };
    const identification = allocateIdentificationMap({ content, rng: base.rng }).identification;
    const run = { ...base, actors: [{ ...base.actors[0]!, health: 10 }], items: [item], identification };
    const result = resolveCommand(run, { type: 'use-item', commandId: 'command.use-unknown', expectedRevision: 0,
      itemId: item.itemId, target: null }, { content });
    expect(result.events.map((event) => event.type)).toEqual([
      'item.used', 'actor.healed', 'identification.appearance-revealed', 'item.consumed',
    ]);
    expect(result.state.identification.knownAppearanceIds).toEqual([
      identification.appearanceByContentId['item.heal'],
    ]);
    expect(decodeActiveRun(encodeActiveRun(result.state))).toEqual(result.state);
  });
});
