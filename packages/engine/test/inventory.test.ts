import { describe, expect, it } from 'vitest';
import type {
  CompiledContentPack,
  ItemContentEntry,
  LootTableContentEntry,
} from '@woven-deep/content';
import {
  canStack,
  createDemoContentPack,
  createRecordedHeirloom,
  createDemoRun,
  consumeItemQuantity,
  createFloorLootFromTable,
  dropItem,
  encodeActiveRun,
  inventorySlotCount,
  mergeStacks,
  pickupItem,
  resolveCommand,
  splitStack,
  validateContentBoundRun,
  type ItemInstance,
  type RecordedHeirloomSnapshot,
  type Uint32State,
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
    artifact: null,
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

  it('credits hero currency on gold pickup without using a backpack slot', () => {
    const pack = content(
      itemDefinition('item.coin'),
      itemDefinition('item.gold-coins', 999, { category: 'currency', tags: ['currency'] }),
    );
    const backpackFiller = Array.from({ length: 12 }, (_, index) =>
      item({ itemId: `item.coin.${index}`, quantity: 1 }),
    );
    const run = {
      ...createDemoRun(),
      items: [
        ...backpackFiller,
        item({
          itemId: 'item.gold-coins.floor',
          contentId: 'item.gold-coins',
          quantity: 12,
          location: { type: 'floor', floorId: 'floor.demo', x: 1, y: 1 },
        }),
      ],
    };
    const before = run.hero.currency;
    const backpackSlotsBefore = run.items.filter(
      (entry) => entry.location.type === 'backpack',
    ).length;
    const { state, events } = resolveCommand(
      run,
      {
        type: 'pickup',
        commandId: 'command.pickup',
        expectedRevision: 0,
        itemId: 'item.gold-coins.floor',
        quantity: 12,
      },
      { content: pack },
    );
    expect(state.hero.currency).toBe(before + 12);
    expect(state.items.find((entry) => entry.itemId === 'item.gold-coins.floor')).toBeUndefined();
    expect(state.items.filter((entry) => entry.location.type === 'backpack').length).toBe(
      backpackSlotsBefore,
    );
    const currencyEvent = events.find((event) => event.type === 'currency.collected');
    expect(currencyEvent).toMatchObject({ amount: 12, currency: before + 12 });
    expect(events.some((event) => event.type === 'item.picked-up')).toBe(false);
    expect(() => encodeActiveRun(state)).not.toThrow();
  });

  it('credits a partial gold pickup and leaves the remainder on the floor', () => {
    const pack = content(
      itemDefinition('item.gold-coins', 999, { category: 'currency', tags: ['currency'] }),
    );
    const run = {
      ...createDemoRun(),
      items: [
        item({
          itemId: 'item.gold-coins.floor',
          contentId: 'item.gold-coins',
          quantity: 20,
          location: { type: 'floor', floorId: 'floor.demo', x: 1, y: 1 },
        }),
      ],
    };
    const before = run.hero.currency;
    const { state, events } = resolveCommand(
      run,
      {
        type: 'pickup',
        commandId: 'command.pickup',
        expectedRevision: 0,
        itemId: 'item.gold-coins.floor',
        quantity: 8,
      },
      { content: pack },
    );
    expect(state.hero.currency).toBe(before + 8);
    expect(state.items).toMatchObject([
      {
        itemId: 'item.gold-coins.floor',
        quantity: 12,
        location: { type: 'floor', x: 1, y: 1 },
      },
    ]);
    const currencyEvent = events.find((event) => event.type === 'currency.collected');
    expect(currencyEvent).toMatchObject({ amount: 8, currency: before + 8 });
    expect(events.some((event) => event.type === 'item.picked-up')).toBe(false);
    expect(() => encodeActiveRun(state)).not.toThrow();
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

describe('createFloorLootFromTable depth banding', () => {
  const bandedTable: LootTableContentEntry = {
    kind: 'loot-table',
    id: 'loot-table.banded',
    name: 'Banded loot',
    tags: [],
    rolls: 1,
    choices: [
      {
        contentId: 'item.trinket-a',
        lootTableId: null,
        weight: 1,
        minimumQuantity: 1,
        maximumQuantity: 1,
      },
      {
        contentId: 'item.deep-relic-b',
        lootTableId: null,
        weight: 1000,
        minimumQuantity: 1,
        maximumQuantity: 1,
        minDepth: 15,
      },
    ],
  };

  function bandedPack(): CompiledContentPack {
    const base = content(itemDefinition('item.trinket-a'), itemDefinition('item.deep-relic-b'));
    return { ...base, entries: [...base.entries, bandedTable] };
  }

  it('never rolls a choice below its authored minDepth', () => {
    const testPack = bandedPack();
    let state: Uint32State = [9, 9, 9, 9];
    for (let i = 0; i < 50; i += 1) {
      const rolled = createFloorLootFromTable({
        content: testPack,
        tableId: 'loot-table.banded',
        state,
        itemIdPrefix: 'item.test',
        floorId: 'floor.test',
        x: 1,
        y: 1,
        depth: 1,
      });
      state = rolled.state;
      expect(rolled.items.every((item) => item.contentId !== 'item.deep-relic-b')).toBe(true);
    }
  });

  it('rolls the banded choice once its authored minDepth is reached', () => {
    const testPack = bandedPack();
    let state: Uint32State = [9, 9, 9, 9];
    let sawDeepRelic = false;
    for (let i = 0; i < 50; i += 1) {
      const rolled = createFloorLootFromTable({
        content: testPack,
        tableId: 'loot-table.banded',
        state,
        itemIdPrefix: 'item.test',
        floorId: 'floor.test',
        x: 1,
        y: 1,
        depth: 15,
      });
      state = rolled.state;
      if (rolled.items.some((item) => item.contentId === 'item.deep-relic-b')) sawDeepRelic = true;
    }
    expect(sawDeepRelic).toBe(true);
  });
});

describe('createRecordedHeirloom artifact recovery', () => {
  const originatingHallRecordId = `record.${'3'.repeat(32)}.${'d'.repeat(16)}`;

  function snapshot(overrides: Partial<RecordedHeirloomSnapshot> = {}): RecordedHeirloomSnapshot {
    return {
      contentId: 'item.marias-grace',
      sourceItemId: 'item.hero.grace',
      enchantment: null,
      condition: 71,
      charges: null,
      fuel: null,
      qualityRank: 0,
      displayName: "Maria's Grace",
      glyph: '(',
      color: '#ffd9a0',
      originatingHallRecordId,
      ...overrides,
    };
  }

  function artifactPack(): CompiledContentPack {
    return content(
      itemDefinition('item.marias-grace', 1, {
        name: "Maria's Grace",
        tags: [],
        glyph: '(',
        color: '#ffd9a0',
        rarity: 'legendary',
        heirloomEligible: true,
        equipment: { slots: ['off-hand'], handedness: 'one-handed', reservedSlots: [] },
        artifact: {
          canon: true,
          signature: null,
          drawbackModifiers: {},
          light: { fuelless: true, inextinguishable: true },
        },
      }),
      itemDefinition('item.champion-fallback-relic', 1, {
        name: 'Fallback relic',
        rarity: 'common',
        heirloomEligible: true,
        equipment: { slots: ['neck'], handedness: 'one-handed', reservedSlots: [] },
      }),
    );
  }

  it('materializes a backpack-held artifact as itself, not the fallback relic', () => {
    const created = createRecordedHeirloom({
      content: artifactPack(),
      snapshot: snapshot(),
      // the champion died with the artifact in the backpack: it is absent from the build snapshot
      equippedItemContentIds: ['item.coin'],
      fallbackItemId: 'item.champion-fallback-relic',
      itemId: 'item.heirloom.population-1',
      floorId: 'floor.1',
      x: 3,
      y: 4,
    });
    expect(created.fallback).toBe(false);
    expect(created.item.contentId).toBe('item.marias-grace');
    expect(created.item.condition).toBe(71);
    expect(created.displayName).toBe("Maria's Grace");
  });

  it('materializes a fuelless light artifact as itself, lightable and doused', () => {
    const pack = content(
      itemDefinition('item.marias-grace', 1, {
        name: "Maria's Grace",
        tags: [],
        glyph: '(',
        color: '#ffd9a0',
        category: 'light',
        rarity: 'legendary',
        heirloomEligible: true,
        equipment: { slots: ['off-hand'], handedness: 'one-handed', reservedSlots: [] },
        light: {
          color: [255, 217, 160],
          radius: 7,
          strength: 180,
          fuelCapacity: 2400,
          fuelPerTime: 1,
          warningThresholds: [600],
          fuelTags: ['lamp-oil'],
        },
        artifact: {
          canon: true,
          signature: null,
          drawbackModifiers: {},
          light: { fuelless: true, inextinguishable: true },
        },
      }),
      itemDefinition('item.champion-fallback-relic', 1, {
        name: 'Fallback relic',
        rarity: 'common',
        heirloomEligible: true,
        equipment: { slots: ['neck'], handedness: 'one-handed', reservedSlots: [] },
      }),
    );
    const created = createRecordedHeirloom({
      content: pack,
      snapshot: snapshot({ fuel: null }),
      equippedItemContentIds: ['item.coin'],
      fallbackItemId: 'item.champion-fallback-relic',
      itemId: 'item.heirloom.population-3',
      floorId: 'floor.1',
      x: 3,
      y: 4,
    });
    expect(created.fallback).toBe(false);
    expect(created.item.contentId).toBe('item.marias-grace');
    expect(created.item).toMatchObject({ fuel: 2400, enabled: false });
  });

  it('still degrades a backpack-held ORDINARY item to the fallback relic', () => {
    const pack = content(
      itemDefinition('item.plain-sword', 1, {
        rarity: 'rare',
        heirloomEligible: true,
        equipment: { slots: ['main-hand'], handedness: 'one-handed', reservedSlots: [] },
      }),
      itemDefinition('item.champion-fallback-relic', 1, {
        name: 'Fallback relic',
        rarity: 'common',
        heirloomEligible: true,
        equipment: { slots: ['neck'], handedness: 'one-handed', reservedSlots: [] },
      }),
    );
    const created = createRecordedHeirloom({
      content: pack,
      snapshot: snapshot({ contentId: 'item.plain-sword' }),
      equippedItemContentIds: ['item.coin'],
      fallbackItemId: 'item.champion-fallback-relic',
      itemId: 'item.heirloom.population-2',
      floorId: 'floor.1',
      x: 3,
      y: 4,
    });
    expect(created.fallback).toBe(true);
    expect(created.item.contentId).toBe('item.champion-fallback-relic');
  });

  it('degrades an artifact snapshot that no longer exists in content', () => {
    const created = createRecordedHeirloom({
      content: artifactPack(),
      snapshot: snapshot({ contentId: 'item.removed-artifact' }),
      equippedItemContentIds: ['item.removed-artifact'],
      fallbackItemId: 'item.champion-fallback-relic',
      itemId: 'item.heirloom.population-3',
      floorId: 'floor.1',
      x: 3,
      y: 4,
    });
    expect(created.fallback).toBe(true);
    expect(created.item.contentId).toBe('item.champion-fallback-relic');
  });
});
