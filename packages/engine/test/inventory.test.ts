import { describe, expect, it } from 'vitest';
import type { CompiledContentPack, ItemContentEntry } from '@woven-deep/content';
import {
  canStack,
  createDemoContentPack,
  createDemoRun,
  consumeItemQuantity,
  dropItem,
  encodeActiveRun,
  inventorySlotCount,
  mergeStacks,
  pickupItem,
  resolveCommand,
  splitStack,
  validateContentBoundRun,
  type ItemInstance,
} from '../src/index.js';

function item(overrides: Partial<ItemInstance> = {}): ItemInstance {
  return {
    itemId: 'item.coin.1',
    contentId: 'item.coin',
    quantity: 1,
    condition: 100,
    enchantment: null,
    identified: true,
    charges: null,
    fuel: null,
    enabled: null,
    location: { type: 'backpack', actorId: 'hero.demo' },
    ...overrides,
  };
}

function itemDefinition(
  id = 'item.coin',
  stackLimit = 10,
  overrides: Partial<ItemContentEntry> = {},
): ItemContentEntry {
  return {
    kind: 'item',
    id,
    name: id,
    glyph: '$',
    color: '#e0c060',
    tags: ['currency'],
    category: 'misc',
    stackLimit,
    price: 1,
    rarity: 'common',
    minDepth: 0,
    maxDepth: 20,
    actionCost: 100,
    equipment: null,
    combat: null,
    light: null,
    identification: { mode: 'known', poolId: null },
    effects: [],
    ...overrides,
  };
}

function content(...definitions: ItemContentEntry[]): CompiledContentPack {
  const base = createDemoContentPack();
  return { ...base, entries: [...base.entries, ...definitions] };
}

describe('immutable inventory transitions', () => {
  it('merges only gameplay-identical stack instances', () => {
    expect(canStack(item({ fuel: 10 }), item({ itemId: 'item.coin.2', fuel: 10 }))).toBe(true);
    expect(canStack(item({ fuel: 10 }), item({ itemId: 'item.coin.2', fuel: 9 }))).toBe(false);
    expect(
      canStack(item({ identified: true }), item({ itemId: 'item.coin.2', identified: false })),
    ).toBe(false);
    expect(
      canStack(
        item(),
        item({
          itemId: 'item.coin.2',
          enchantment: { enchantmentId: 'enchantment.a', modifiers: {} },
        }),
      ),
    ).toBe(false);
    const provenance = {
      displayName: 'Ancestral coin',
      glyph: '$',
      color: '#e0c060',
      originatingHallRecordId: 'hall.one',
      originatingRank: 1 as const,
      sourceItemId: 'item.source',
    };
    expect(canStack(item({ heirloom: provenance }), item({ itemId: 'item.coin.2' }))).toBe(false);
    expect(
      canStack(
        item({ heirloom: provenance }),
        item({ itemId: 'item.coin.2', heirloom: provenance }),
      ),
    ).toBe(false);
  });

  it('counts backpack stacks but excludes equipped items', () => {
    const run = createDemoRun();
    const items = [
      item(),
      item({ itemId: 'item.coin.2', contentId: 'item.gem' }),
      item({
        itemId: 'item.sword.1',
        contentId: 'item.sword',
        location: { type: 'equipped', actorId: 'hero.demo', slot: 'main-hand' },
      }),
    ];
    expect(inventorySlotCount({ run: { ...run, items }, actorId: 'hero.demo' })).toEqual({
      used: 2,
      capacity: 12,
    });
  });

  it('fails atomically when pickup would exceed slot capacity', () => {
    const run = createDemoRun();
    const full = {
      ...run,
      hero: { ...run.hero, backpackCapacity: 1 },
      items: [
        item(),
        item({
          itemId: 'item.gem.floor',
          contentId: 'item.gem',
          location: { type: 'floor', floorId: 'floor.demo', x: 1, y: 1 },
        }),
      ],
    };
    const before = structuredClone(full);
    expect(
      pickupItem({
        run: full,
        content: content(itemDefinition(), itemDefinition('item.gem')),
        actorId: 'hero.demo',
        itemId: 'item.gem.floor',
        quantity: 1,
      }),
    ).toEqual({ ok: false, reason: 'inventory.full' });
    expect(full).toEqual(before);
  });

  it('splits and merges without changing total quantity', () => {
    const run = { ...createDemoRun(), items: [item({ quantity: 7 })] };
    const pack = content(itemDefinition());
    const split = splitStack({
      run,
      content: pack,
      actorId: 'hero.demo',
      itemId: 'item.coin.1',
      quantity: 3,
      newItemId: 'item.coin.2',
    });
    expect(split.ok).toBe(true);
    if (!split.ok) return;
    expect(split.items.reduce((sum, entry) => sum + entry.quantity, 0)).toBe(7);
    const merged = mergeStacks({
      run: split.run,
      content: pack,
      actorId: 'hero.demo',
      leftItemId: 'item.coin.1',
      rightItemId: 'item.coin.2',
    });
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    expect(merged.items).toHaveLength(1);
    expect(merged.items[0]).toMatchObject({ itemId: 'item.coin.1', quantity: 7 });
    expect(run.items).toEqual([item({ quantity: 7 })]);
  });

  it('validates item definitions, stack limits, and the exact content hash', () => {
    const pack = content(itemDefinition('item.coin', 5));
    const run = { ...createDemoRun(), items: [item({ quantity: 5 })] };
    expect(() => validateContentBoundRun(run, pack)).not.toThrow();
    expect(() => validateContentBoundRun({ ...run, items: [item({ quantity: 6 })] }, pack)).toThrow(
      /stack limit/i,
    );
    expect(() =>
      validateContentBoundRun({ ...run, items: [item({ contentId: 'item.missing' })] }, pack),
    ).toThrow(/definition/i);
    expect(() => validateContentBoundRun({ ...run, contentHash: 'b'.repeat(64) }, pack)).toThrow(
      /content hash/i,
    );
  });

  it('merges pickup stacks by item ID before allocating another slot', () => {
    const run = {
      ...createDemoRun(),
      items: [
        item({ quantity: 8 }),
        item({
          itemId: 'item.coin.floor',
          quantity: 7,
          location: { type: 'floor', floorId: 'floor.demo', x: 1, y: 1 },
        }),
      ],
    };
    const result = pickupItem({
      run,
      content: content(itemDefinition()),
      actorId: 'hero.demo',
      itemId: 'item.coin.floor',
      quantity: 5,
      newItemId: 'item.coin.picked',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items).toMatchObject([
      { itemId: 'item.coin.1', quantity: 10, location: { type: 'backpack' } },
      { itemId: 'item.coin.floor', quantity: 2, location: { type: 'floor' } },
      { itemId: 'item.coin.picked', quantity: 3, location: { type: 'backpack' } },
    ]);
    expect(result.items.reduce((sum, entry) => sum + entry.quantity, 0)).toBe(15);
  });

  it('drops a partial stack at the actor cell and removes a consumed last unit', () => {
    const run = { ...createDemoRun(), items: [item({ quantity: 3 })] };
    const dropped = dropItem({
      run,
      actorId: 'hero.demo',
      itemId: 'item.coin.1',
      quantity: 2,
      newItemId: 'item.coin.floor',
    });
    expect(dropped.ok).toBe(true);
    if (!dropped.ok) return;
    expect(dropped.items).toMatchObject([
      { itemId: 'item.coin.1', quantity: 1, location: { type: 'backpack' } },
      {
        itemId: 'item.coin.floor',
        quantity: 2,
        location: { type: 'floor', floorId: 'floor.demo', x: 1, y: 1 },
      },
    ]);
    const consumed = consumeItemQuantity({ run: dropped.run, itemId: 'item.coin.1', quantity: 1 });
    expect(consumed.ok).toBe(true);
    if (consumed.ok)
      expect(consumed.items.map((entry) => entry.itemId)).toEqual(['item.coin.floor']);
  });

  it('applies pickup and drop commands as timed saved actions', () => {
    const pack = content(itemDefinition());
    const run = {
      ...createDemoRun(),
      items: [
        item({
          itemId: 'item.coin.floor',
          quantity: 2,
          location: { type: 'floor', floorId: 'floor.demo', x: 1, y: 1 },
        }),
      ],
    };
    const picked = resolveCommand(
      run,
      {
        type: 'pickup',
        commandId: 'command.pickup',
        expectedRevision: 0,
        itemId: 'item.coin.floor',
        quantity: 2,
      },
      { content: pack },
    );
    expect(picked.result).toMatchObject({ status: 'applied' });
    expect(picked.events).toMatchObject([
      { type: 'item.picked-up', itemId: 'item.coin.floor', quantity: 2 },
    ]);
    expect(picked.state.items[0]!.location).toEqual({ type: 'backpack', actorId: 'hero.demo' });
    expect(() => encodeActiveRun(picked.state)).not.toThrow();

    const dropped = resolveCommand(
      picked.state,
      {
        type: 'drop',
        commandId: 'command.drop',
        expectedRevision: 1,
        itemId: 'item.coin.floor',
        quantity: 2,
      },
      { content: pack },
    );
    expect(dropped.result).toMatchObject({ status: 'applied' });
    expect(dropped.state.items[0]!.location).toEqual({
      type: 'floor',
      floorId: 'floor.demo',
      x: 1,
      y: 1,
    });
    expect(() => encodeActiveRun(dropped.state)).not.toThrow();
  });

  it('applies a split command with its caller-supplied stable item ID', () => {
    const pack = content(itemDefinition());
    const run = { ...createDemoRun(), items: [item({ quantity: 4 })] };
    const result = resolveCommand(
      run,
      {
        type: 'split-stack',
        commandId: 'command.split',
        expectedRevision: 0,
        itemId: 'item.coin.1',
        quantity: 2,
        newItemId: 'item.coin.2',
      },
      { content: pack },
    );
    expect(result.result).toMatchObject({ status: 'applied' });
    expect(result.state.items).toMatchObject([
      { itemId: 'item.coin.1', quantity: 2 },
      { itemId: 'item.coin.2', quantity: 2 },
    ]);
    expect(() => encodeActiveRun(result.state)).not.toThrow();
  });

  it('validates ammunition before firing and consumes the last unit only after the shot starts', () => {
    const weaponDefinition = itemDefinition('item.bow', 1, {
      category: 'weapon',
      tags: ['bow'],
      equipment: { slots: ['main-hand'], handedness: 'two-handed', reservedSlots: ['off-hand'] },
      combat: {
        accuracy: 100,
        defense: 0,
        armor: 0,
        damage: { count: 1, sides: 1, bonus: 0 },
        range: 5,
        ammunitionTag: 'arrow',
      },
    });
    const arrowDefinition = itemDefinition('item.arrow', 20, {
      category: 'ammunition',
      tags: ['arrow'],
    });
    const pack = content(weaponDefinition, arrowDefinition);
    const base = createDemoRun();
    const hero = {
      ...base.actors[0]!,
      equipment: { ...base.actors[0]!.equipment, 'main-hand': 'item.bow.1' },
    };
    const target = {
      ...base.actors[0]!,
      actorId: 'monster.target',
      contentId: 'monster.target',
      playerControlled: false,
      x: 3,
      y: 1,
      energy: 0,
      disposition: 'hostile' as const,
    };
    const bow = item({
      itemId: 'item.bow.1',
      contentId: 'item.bow',
      location: { type: 'equipped', actorId: 'hero.demo', slot: 'main-hand' },
    });
    const noAmmo = { ...base, actors: [hero, target], items: [bow] };
    const command = {
      type: 'fire' as const,
      commandId: 'command.fire',
      expectedRevision: 0,
      itemId: bow.itemId,
      target: { x: 3, y: 1 },
    };
    expect(resolveCommand(noAmmo, command, { content: pack }).result).toMatchObject({
      status: 'invalid',
    });
    expect(noAmmo.items).toEqual([bow]);

    const boltDefinition = itemDefinition('item.bolt', 20, {
      category: 'ammunition',
      tags: ['bolt'],
    });
    const bolt = item({ itemId: 'item.bolt.1', contentId: 'item.bolt' });
    expect(
      resolveCommand({ ...noAmmo, items: [bolt, bow] }, command, {
        content: content(weaponDefinition, arrowDefinition, boltDefinition),
      }).result,
    ).toMatchObject({ status: 'invalid', reason: 'item.missing' });

    const arrow = item({ itemId: 'item.arrow.1', contentId: 'item.arrow', quantity: 1 });
    const armed = { ...noAmmo, items: [arrow, bow] };
    const invalidTarget = resolveCommand(
      armed,
      { ...command, target: { x: 5, y: 3 } },
      { content: pack },
    );
    expect(invalidTarget.result).toMatchObject({ status: 'invalid' });
    expect(invalidTarget.state.items).toEqual(armed.items);

    const fired = resolveCommand(armed, command, { content: pack });
    expect(fired.result).toMatchObject({ status: 'applied' });
    expect(fired.state.items.map((entry) => entry.itemId)).toEqual([bow.itemId]);
    expect(fired.events.some((event) => event.type === 'combat.observed')).toBe(true);
    expect(() => encodeActiveRun(fired.state)).not.toThrow();
  });

  it('places a thrown partial stack at the selected visible cell', () => {
    const pack = content(itemDefinition('item.rock', 10));
    const run = {
      ...createDemoRun(),
      items: [item({ itemId: 'item.rock.1', contentId: 'item.rock', quantity: 3 })],
    };
    const result = resolveCommand(
      run,
      {
        type: 'throw-item',
        commandId: 'command.throw',
        expectedRevision: 0,
        itemId: 'item.rock.1',
        quantity: 2,
        target: { x: 2, y: 1 },
      },
      { content: pack },
    );
    expect(result.result).toMatchObject({ status: 'applied' });
    expect(result.state.items).toMatchObject([
      { itemId: 'command.throw', quantity: 2, location: { type: 'floor', x: 2, y: 1 } },
      { itemId: 'item.rock.1', quantity: 1, location: { type: 'backpack' } },
    ]);
    expect(() => encodeActiveRun(result.state)).not.toThrow();
  });

  it('uses authored effects and consumes only their declared quantity', () => {
    const potionDefinition = itemDefinition('item.potion', 5, {
      category: 'potion',
      effects: [
        {
          effectId: 'effect.heal',
          parameters: { dice: { count: 1, sides: 1, bonus: 4 } },
          requiresLivingTarget: true,
        },
        {
          effectId: 'effect.item.consume',
          parameters: { quantity: 1 },
          requiresLivingTarget: false,
        },
      ],
    });
    const pack = content(potionDefinition);
    const base = createDemoRun();
    const run = {
      ...base,
      actors: [{ ...base.actors[0]!, health: 10 }],
      items: [item({ itemId: 'item.potion.1', contentId: potionDefinition.id, quantity: 1 })],
    };
    const result = resolveCommand(
      run,
      {
        type: 'use-item',
        commandId: 'command.use',
        expectedRevision: 0,
        itemId: 'item.potion.1',
        target: null,
      },
      { content: pack },
    );
    expect(result.result).toMatchObject({ status: 'applied' });
    expect(result.state.actors[0]!.health).toBe(15);
    expect(result.state.items).toEqual([]);
    expect(() => encodeActiveRun(result.state)).not.toThrow();
  });

  it('applies a thrown consumable effect instead of leaving the item on the floor', () => {
    const flaskDefinition = itemDefinition('item.flask', 5, {
      category: 'potion',
      effects: [
        {
          effectId: 'effect.damage',
          parameters: { damageType: 'fire', dice: { count: 1, sides: 1, bonus: 0 } },
          requiresLivingTarget: true,
        },
        {
          effectId: 'effect.item.consume',
          parameters: { quantity: 1 },
          requiresLivingTarget: false,
        },
      ],
    });
    const pack = content(flaskDefinition);
    const base = createDemoRun();
    const target = {
      ...base.actors[0]!,
      actorId: 'monster.flask-target',
      contentId: 'monster.flask-target',
      playerControlled: false,
      x: 2,
      y: 1,
      energy: 0,
      disposition: 'hostile' as const,
    };
    const run = {
      ...base,
      actors: [base.actors[0]!, target],
      items: [item({ itemId: 'item.flask.1', contentId: flaskDefinition.id })],
    };
    const result = resolveCommand(
      run,
      {
        type: 'throw-item',
        commandId: 'command.throw-flask',
        expectedRevision: 0,
        itemId: 'item.flask.1',
        quantity: 1,
        target: { x: 2, y: 1 },
      },
      { content: pack },
    );
    expect(result.result).toMatchObject({ status: 'applied' });
    expect(result.state.items).toEqual([]);
    expect(result.state.actors.find((actor) => actor.actorId === target.actorId)!.health).toBe(19);
  });
});
