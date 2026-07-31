import { describe, expect, it } from 'vitest';
import type {
  BalanceContentEntry,
  CompiledContentPack,
  CurseContentEntry,
  ItemContentEntry,
  LootTableContentEntry,
  MonsterContentEntry,
} from '@woven-deep/content';
import {
  createDemoContentPack,
  createDemoRun,
  dropMonsterLoot,
  type ActiveRun,
  type ActorState,
} from '../src/index.js';

function itemDef(id: string): ItemContentEntry {
  return {
    kind: 'item',
    id,
    name: id,
    tags: [],
    glyph: '*',
    color: '#ffaa00',
    category: 'misc',
    stackLimit: 10,
    price: 1,
    rarity: 'common',
    minDepth: 1,
    maxDepth: 20,
    actionCost: 100,
    equipment: null,
    combat: null,
    light: null,
    artifact: null,
    identification: { mode: 'known', poolId: null },
    effects: [],
  };
}

const lootTable: LootTableContentEntry = {
  kind: 'loot-table',
  id: 'loot-table.cave-rat',
  name: 'Cave rat loot',
  tags: [],
  rolls: 1,
  choices: [
    {
      contentId: 'item.rat-tail',
      lootTableId: null,
      weight: 1,
      minimumQuantity: 1,
      maximumQuantity: 1,
    },
  ],
};

function monster(
  overrides: Readonly<{ lootTableId: string | null; dropChance: number }>,
): MonsterContentEntry {
  return {
    kind: 'monster',
    id: 'monster.cave-rat',
    name: 'Cave rat',
    tags: [],
    glyph: 'r',
    color: '#8a7766',
    attributes: { might: 4, agility: 8, vitality: 4, wits: 2, resolve: 2 },
    health: 6,
    speed: 100,
    accuracy: 4,
    defense: 2,
    perception: 6,
    damage: { count: 1, sides: 3, bonus: 0 },
    armor: 0,
    resistances: { physical: 0, fire: 0, cold: 0, lightning: 0, poison: 0, arcane: 0 },
    disposition: 'hostile',
    behaviorId: 'behavior.approach-and-attack',
    behaviorParameters: {},
    minDepth: 1,
    maxDepth: 20,
    threat: 1,
    rarity: 'common',
    lootTableId: overrides.lootTableId,
    dropChance: overrides.dropChance,
  };
}

function fixtureWith(
  overrides: Readonly<{ lootTableId: string | null; dropChance: number }>,
): Readonly<{
  run: ActiveRun;
  state: ActiveRun;
  content: CompiledContentPack;
  deadActor: ActorState;
}> {
  const base = createDemoRun();
  const monsterEntry = monster(overrides);
  const content: CompiledContentPack = {
    ...createDemoContentPack(),
    entries: [
      ...createDemoContentPack().entries,
      monsterEntry,
      lootTable,
      itemDef('item.rat-tail'),
    ],
  };
  const deadActor: ActorState = {
    ...base.actors[0]!,
    actorId: 'actor.cave-rat.1',
    contentId: monsterEntry.id,
    playerControlled: false,
    health: 0,
    maxHealth: monsterEntry.health,
    x: 2,
    y: 2,
  };
  const run: ActiveRun = { ...base, actors: [...base.actors, deadActor] };
  return { run, state: run, content, deadActor };
}

describe('dropMonsterLoot', () => {
  it('drops nothing and leaves state.items unchanged for a monster with no loot table', () => {
    const { run, content, deadActor } = fixtureWith({ lootTableId: null, dropChance: 1 });
    const out = dropMonsterLoot({ state: run, content, deadActor, eventId: 'evt.1' });
    expect(out.state.items).toEqual(run.items);
    expect(out.events).toEqual([]);
    expect(out.state.rng.loot).toEqual(run.rng.loot);
  });

  it('with dropChance 0 advances the loot rng but drops nothing', () => {
    const { run, content, deadActor } = fixtureWith({
      lootTableId: 'loot-table.cave-rat',
      dropChance: 0,
    });
    const out = dropMonsterLoot({ state: run, content, deadActor, eventId: 'evt.1' });
    expect(out.state.items).toEqual(run.items);
    expect(out.state.rng.loot).not.toEqual(run.rng.loot);
    expect(out.events).toEqual([]);
  });

  it('with dropChance 1 drops the table result at the death tile and emits loot.dropped', () => {
    const { run, content, deadActor } = fixtureWith({
      lootTableId: 'loot-table.cave-rat',
      dropChance: 1,
    });
    const out = dropMonsterLoot({ state: run, content, deadActor, eventId: 'evt.1' });
    const dropped = out.state.items.filter((i) => !run.items.some((r) => r.itemId === i.itemId));
    expect(dropped.length).toBeGreaterThan(0);
    for (const item of dropped) {
      expect(item.location).toEqual({
        type: 'floor',
        floorId: deadActor.floorId,
        x: deadActor.x,
        y: deadActor.y,
      });
    }
    expect(out.events).toEqual([
      {
        type: 'loot.dropped',
        eventId: 'evt.1',
        actorId: deadActor.actorId,
        contentId: deadActor.contentId,
        x: deadActor.x,
        y: deadActor.y,
        itemIds: dropped.map((d) => d.itemId).sort(),
      },
    ]);
  });

  it('is deterministic for a fixed loot rng state', () => {
    const a = fixtureWith({ lootTableId: 'loot-table.cave-rat', dropChance: 1 });
    const b = fixtureWith({ lootTableId: 'loot-table.cave-rat', dropChance: 1 });
    expect(dropMonsterLoot({ ...a, deadActor: a.deadActor, eventId: 'e' }).state.items).toEqual(
      dropMonsterLoot({ ...b, deadActor: b.deadActor, eventId: 'e' }).state.items,
    );
  });
});

const weaponDrop: ItemContentEntry = {
  kind: 'item',
  id: 'item.dropped-axe',
  name: 'Dropped Axe',
  tags: [],
  glyph: '/',
  color: '#aaaaaa',
  category: 'weapon',
  stackLimit: 1,
  price: 5,
  rarity: 'common',
  minDepth: 1,
  maxDepth: 20,
  actionCost: 100,
  equipment: { slots: ['main-hand'], handedness: 'one-handed', reservedSlots: [] },
  combat: {
    accuracy: 0,
    defense: 0,
    armor: 0,
    damage: { count: 1, sides: 4, bonus: 0 },
    range: 1,
    ammunitionTag: null,
  },
  light: null,
  artifact: null,
  identification: { mode: 'known', poolId: null },
  effects: [],
};

const weaponDropLootTable: LootTableContentEntry = {
  kind: 'loot-table',
  id: 'loot-table.cave-rat-weapon',
  name: 'Cave rat weapon drop',
  tags: [],
  rolls: 1,
  choices: [
    {
      contentId: weaponDrop.id,
      lootTableId: null,
      weight: 1,
      minimumQuantity: 1,
      maximumQuantity: 1,
    },
  ],
};

const dropCurse: CurseContentEntry = {
  kind: 'curse',
  id: 'curse.dropped-axe-test',
  name: 'Test Curse',
  tags: ['curse', 'weapon'],
  revealText: 'It bites the hand that swings it.',
  drawbackModifiers: { meleeAccuracy: -1 },
  trigger: null,
};

/** Every band's `chanceBps` forced to 10000 and `capBps` raised to 10000 (uncapped) so a curse
 * always resolves once rolled -- `capBps` otherwise clamps a forced 10000 chance back down to the
 * pack's authored cap (5000 in the demo pack), which would only curse half the time. */
function forceCurseChance(content: CompiledContentPack): CompiledContentPack {
  return {
    ...content,
    entries: content.entries.map((entry) => {
      if (entry.kind !== 'balance') return entry;
      const balance = entry as BalanceContentEntry;
      return {
        ...balance,
        curses: {
          ...balance.curses,
          chanceBps: { shallow: 10000, mid: 10000, deep: 10000 },
          capBps: 10000,
        },
      };
    }),
  };
}

function weaponDropFixture(): Readonly<{
  run: ActiveRun;
  content: CompiledContentPack;
  deadActor: ActorState;
}> {
  const base = createDemoRun();
  const monsterEntry = monster({ lootTableId: weaponDropLootTable.id, dropChance: 1 });
  const content = forceCurseChance({
    ...createDemoContentPack(),
    entries: [
      ...createDemoContentPack().entries,
      monsterEntry,
      weaponDropLootTable,
      weaponDrop,
      dropCurse,
    ],
  });
  const deadActor: ActorState = {
    ...base.actors[0]!,
    actorId: 'actor.cave-rat.weapon',
    contentId: monsterEntry.id,
    playerControlled: false,
    health: 0,
    maxHealth: monsterEntry.health,
    x: 2,
    y: 2,
  };
  const run: ActiveRun = { ...base, actors: [...base.actors, deadActor] };
  return { run, content, deadActor };
}

describe('dropMonsterLoot curses', () => {
  it('rolls a curse onto an eligible monster drop, threading run.rng.loot', () => {
    const { run, content, deadActor } = weaponDropFixture();
    const out = dropMonsterLoot({ state: run, content, deadActor, eventId: 'evt.curse' });
    const dropped = out.state.items.filter((item) => item.contentId === weaponDrop.id);
    expect(dropped.length).toBe(1);
    expect(dropped[0]!.curse).toEqual({ curseId: dropCurse.id, revealed: false });
    // The curse draw must consume from the same `loot` stream the drop itself rolled from --
    // no separate stream introduced for the curse roll.
    expect(out.state.rng.loot).not.toEqual(run.rng.loot);
  });
});
