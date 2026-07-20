import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  createNewRun,
  DEFAULT_GUEST_HERO,
  decodeActiveRun,
  descendToNextFloor,
  encodeActiveRun,
  heroActor,
  movementBlockReason,
  resolveCommand,
  validateActiveRun,
  type ActiveRun,
  type FloorSnapshot,
  type ItemInstance,
} from '../src/index.js';

let pack: CompiledContentPack;

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

const SEED = [17, 19, 23, 29] as const;

function townRun(): ActiveRun {
  return createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
}

function context() {
  return { content: pack };
}

function townFloor(run: ActiveRun): FloorSnapshot {
  return run.floors.find((floor) => floor.floorId === run.activeFloorId)!;
}

function houseDoorPosition(run: ActiveRun): Readonly<{ x: number; y: number }> {
  const slot = townFloor(run).placementSlots.find((candidate) =>
    candidate.tags.includes('house-door'),
  );
  if (!slot) throw new Error('test setup failure: town floor is missing a house-door slot');
  return { x: slot.x, y: slot.y };
}

function adjacentFreeCell(
  run: ActiveRun,
  target: Readonly<{ x: number; y: number }>,
): Readonly<{ x: number; y: number }> {
  const floor = townFloor(run);
  const occupied = new Set(
    run.actors
      .filter((actor) => actor.floorId === floor.floorId && actor.health > 0)
      .map((actor) => `${actor.x}:${actor.y}`),
  );
  for (const [dx, dy] of [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ] as const) {
    const x = target.x + dx;
    const y = target.y + dy;
    if (x < 0 || y < 0 || x >= floor.width || y >= floor.height) continue;
    if (movementBlockReason(floor.tiles[y * floor.width + x]!) !== undefined) continue;
    if (occupied.has(`${x}:${y}`)) continue;
    return { x, y };
  }
  throw new Error('test setup failure: cannot stand adjacent to the house door');
}

function atHouseDoor(run: ActiveRun): ActiveRun {
  const hero = heroActor(run);
  const cell = adjacentFreeCell(run, houseDoorPosition(run));
  return validateActiveRun({
    ...run,
    actors: run.actors.map((actor) =>
      actor.actorId === hero.actorId ? { ...actor, ...cell } : actor,
    ),
  });
}

function farFromHouseDoor(run: ActiveRun): ActiveRun {
  const hero = heroActor(run);
  const floor = townFloor(run);
  const door = houseDoorPosition(run);
  const occupied = new Set(
    run.actors
      .filter((actor) => actor.floorId === floor.floorId && actor.health > 0)
      .map((actor) => `${actor.x}:${actor.y}`),
  );
  for (let y = 0; y < floor.height; y += 1) {
    for (let x = 0; x < floor.width; x += 1) {
      if (Math.max(Math.abs(x - door.x), Math.abs(y - door.y)) <= 1) continue;
      if (movementBlockReason(floor.tiles[y * floor.width + x]!) !== undefined) continue;
      if (occupied.has(`${x}:${y}`)) continue;
      return validateActiveRun({
        ...run,
        actors: run.actors.map((actor) =>
          actor.actorId === hero.actorId ? { ...actor, x, y } : actor,
        ),
      });
    }
  }
  throw new Error('test setup failure: town floor has no cell far from the house door');
}

function backpackItem(
  itemId: string,
  contentId: string,
  quantity: number,
  heroActorId: string,
  overrides: Partial<ItemInstance> = {},
): ItemInstance {
  return {
    itemId,
    contentId,
    quantity,
    condition: 100,
    enchantment: null,
    identified: true,
    charges: null,
    fuel: null,
    enabled: null,
    location: { type: 'backpack', actorId: heroActorId },
    ...overrides,
  };
}

function withItems(run: ActiveRun, items: readonly ItemInstance[]): ActiveRun {
  return validateActiveRun({
    ...run,
    items: [...run.items, ...items].sort((left, right) =>
      left.itemId < right.itemId ? -1 : left.itemId > right.itemId ? 1 : 0,
    ),
  });
}

describe('house deposit/withdraw legality matrix', () => {
  it('rejects a deposit while off the town floor', () => {
    const base = atHouseDoor(townRun());
    const hero = heroActor(base);
    const withItem = withItems(base, [
      backpackItem('item.house-test.a', 'item.iron-sword', 1, hero.actorId),
    ]);
    const stairDown = townFloor(withItem).stairDown!;
    const onStairs = validateActiveRun({
      ...withItem,
      actors: withItem.actors.map((actor) =>
        actor.actorId === hero.actorId ? { ...actor, ...stairDown } : actor,
      ),
    });
    const notTown = descendToNextFloor(onStairs, context()).state;
    const resolved = resolveCommand(
      notTown,
      {
        type: 'house-deposit',
        commandId: 'command.deposit',
        expectedRevision: notTown.revision,
        itemId: 'item.house-test.a',
        quantity: 1,
      },
      context(),
    );
    expect(resolved.result).toMatchObject({ status: 'invalid', reason: 'item.unavailable' });
  });

  it('rejects a deposit while not adjacent to the house door', () => {
    const base = townRun();
    const hero = heroActor(base);
    const run = withItems(farFromHouseDoor(base), [
      backpackItem('item.house-test.a', 'item.iron-sword', 1, hero.actorId),
    ]);
    const resolved = resolveCommand(
      run,
      {
        type: 'house-deposit',
        commandId: 'command.deposit',
        expectedRevision: run.revision,
        itemId: 'item.house-test.a',
        quantity: 1,
      },
      context(),
    );
    expect(resolved.result).toMatchObject({ status: 'invalid', reason: 'item.unavailable' });
  });

  it('rejects a deposit that would exceed house capacity', () => {
    const base = atHouseDoor(townRun());
    const hero = heroActor(base);
    // Fill the house to its starting capacity (6) with distinct, non-stackable stacks.
    const filler = Array.from({ length: base.house.capacity }, (_, index) =>
      backpackItem(`item.house-full.${index}`, 'item.iron-sword', 1, 'house-owner', {
        location: { type: 'house' },
      }),
    );
    const run = withItems(base, [
      ...filler,
      backpackItem('item.house-test.a', 'item.wooden-shield', 1, hero.actorId),
    ]);
    const resolved = resolveCommand(
      run,
      {
        type: 'house-deposit',
        commandId: 'command.deposit',
        expectedRevision: run.revision,
        itemId: 'item.house-test.a',
        quantity: 1,
      },
      context(),
    );
    expect(resolved.result).toMatchObject({ status: 'invalid', reason: 'house.full' });
  });

  it('rejects a withdrawal that would exceed backpack capacity', () => {
    const base = atHouseDoor(townRun());
    const hero = heroActor(base);
    const filler = Array.from({ length: base.hero.backpackCapacity }, (_, index) =>
      backpackItem(`item.backpack-full.${index}`, 'item.iron-sword', 1, hero.actorId),
    );
    const run = withItems(base, [
      ...filler,
      backpackItem('item.house-test.a', 'item.wooden-shield', 1, hero.actorId, {
        location: { type: 'house' },
      }),
    ]);
    const resolved = resolveCommand(
      run,
      {
        type: 'house-withdraw',
        commandId: 'command.withdraw',
        expectedRevision: run.revision,
        itemId: 'item.house-test.a',
        quantity: 1,
      },
      context(),
    );
    expect(resolved.result).toMatchObject({ status: 'invalid', reason: 'inventory.full' });
  });

  it('splits a partial quantity on deposit and withdraw, leaving the remainder where it started', () => {
    const base = atHouseDoor(townRun());
    const hero = heroActor(base);
    const run = withItems(base, [
      backpackItem('item.house-test.stack', 'item.wooden-arrows', 10, hero.actorId),
    ]);
    const deposited = resolveCommand(
      run,
      {
        type: 'house-deposit',
        commandId: 'command.deposit-split',
        expectedRevision: run.revision,
        itemId: 'item.house-test.stack',
        quantity: 4,
      },
      context(),
    );
    expect(deposited.result.status).toBe('applied');
    const source = deposited.state.items.find((item) => item.itemId === 'item.house-test.stack')!;
    expect(source.location).toEqual({ type: 'backpack', actorId: hero.actorId });
    expect(source.quantity).toBe(6);
    const carried = deposited.state.items.find(
      (item) => item.location.type === 'house' && item.contentId === 'item.wooden-arrows',
    );
    expect(carried?.quantity).toBe(4);

    const withdrawn = resolveCommand(
      deposited.state,
      {
        type: 'house-withdraw',
        commandId: 'command.withdraw-split',
        expectedRevision: deposited.state.revision,
        itemId: carried!.itemId,
        quantity: 1,
      },
      context(),
    );
    expect(withdrawn.result.status).toBe('applied');
    const remaining = withdrawn.state.items.find((item) => item.itemId === carried!.itemId);
    expect(remaining?.location).toEqual({ type: 'house' });
    expect(remaining?.quantity).toBe(3);
  });

  it('encodes a run whose recentCommands include an applied (event-free) house command', () => {
    // House deposit/withdraw are legitimately event-free (they only relocate an item), but they are
    // still recorded in recentCommands for dedup. Persistence must accept an applied house command
    // that carries zero events -- a real guest session encodes after every command.
    const base = atHouseDoor(townRun());
    const hero = heroActor(base);
    const run = withItems(base, [
      backpackItem('item.house-test.stack', 'item.wooden-arrows', 10, hero.actorId),
    ]);
    const deposited = resolveCommand(
      run,
      {
        type: 'house-deposit',
        commandId: 'command.deposit-persisted',
        expectedRevision: run.revision,
        itemId: 'item.house-test.stack',
        quantity: 4,
      },
      context(),
    );
    expect(deposited.result.status).toBe('applied');
    const encoded = encodeActiveRun(deposited.state);
    expect(() => encoded).not.toThrow();

    const decoded = decodeActiveRun(encoded);
    expect(encodeActiveRun(decoded)).toBe(encoded);
    const recorded = decoded.recentCommands.find(
      (entry) => entry.command.commandId === 'command.deposit-persisted',
    );
    expect(recorded?.command).toEqual({
      type: 'house-deposit',
      commandId: 'command.deposit-persisted',
      expectedRevision: run.revision,
      itemId: 'item.house-test.stack',
      quantity: 4,
    });
    expect(recorded?.result.status).toBe('applied');
  });

  it('round-trips a whole enchanted stack through the house, preserving its identity exactly', () => {
    const base = atHouseDoor(townRun());
    const hero = heroActor(base);
    const enchanted: ItemInstance = backpackItem(
      'item.house-test.enchanted',
      'item.iron-sword',
      1,
      hero.actorId,
      {
        enchantment: { enchantmentId: 'enchantment.test', modifiers: { defense: 2 } },
        condition: 87,
      },
    );
    const run = withItems(base, [enchanted]);
    const deposited = resolveCommand(
      run,
      {
        type: 'house-deposit',
        commandId: 'command.deposit-whole',
        expectedRevision: run.revision,
        itemId: enchanted.itemId,
        quantity: 1,
      },
      context(),
    );
    expect(deposited.result.status).toBe('applied');
    const inHouse = deposited.state.items.find((item) => item.itemId === enchanted.itemId)!;
    expect(inHouse.location).toEqual({ type: 'house' });
    expect(inHouse.enchantment).toEqual(enchanted.enchantment);
    expect(inHouse.condition).toBe(87);

    const withdrawn = resolveCommand(
      deposited.state,
      {
        type: 'house-withdraw',
        commandId: 'command.withdraw-whole',
        expectedRevision: deposited.state.revision,
        itemId: enchanted.itemId,
        quantity: 1,
      },
      context(),
    );
    expect(withdrawn.result.status).toBe('applied');
    const backInBackpack = withdrawn.state.items.find((item) => item.itemId === enchanted.itemId)!;
    expect(backInBackpack).toEqual({
      ...enchanted,
      location: { type: 'backpack', actorId: hero.actorId },
    });
  });
});

describe('house command reducer wiring', () => {
  it('is revision-only: no turn, worldTime, or survival change', () => {
    const base = atHouseDoor(townRun());
    const hero = heroActor(base);
    const run = withItems(base, [
      backpackItem('item.house-test.wire', 'item.iron-sword', 1, hero.actorId),
    ]);
    const resolved = resolveCommand(
      run,
      {
        type: 'house-deposit',
        commandId: 'command.wire',
        expectedRevision: run.revision,
        itemId: 'item.house-test.wire',
        quantity: 1,
      },
      context(),
    );
    expect(resolved.result).toMatchObject({
      status: 'applied',
      revision: run.revision + 1,
      turn: run.turn,
    });
    expect(resolved.state.turn).toBe(run.turn);
    expect(resolved.state.worldTime).toBe(run.worldTime);
    expect(resolved.state.survival).toEqual(run.survival);
  });

  it('records the command and is replay-idempotent on a duplicate submission', () => {
    const base = atHouseDoor(townRun());
    const hero = heroActor(base);
    const run = withItems(base, [
      backpackItem('item.house-test.dup', 'item.iron-sword', 1, hero.actorId),
    ]);
    const command = {
      type: 'house-deposit' as const,
      commandId: 'command.dup',
      expectedRevision: run.revision,
      itemId: 'item.house-test.dup',
      quantity: 1,
    };
    const first = resolveCommand(run, command, context());
    expect(first.result.status).toBe('applied');
    expect(first.state.recentCommands.at(-1)?.command).toEqual(command);

    const replayed = resolveCommand(first.state, command, context());
    expect(replayed.result).toEqual(first.result);
    expect(replayed.state).toEqual(first.state);
  });
});
