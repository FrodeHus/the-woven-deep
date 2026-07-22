import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import type { GameplayProjection } from '@woven-deep/engine';
import { DEFAULT_GUEST_HERO, createNewRun, projectGameplayState } from '@woven-deep/engine';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import { buildIntent } from '../src/command-builder.js';

let pack: CompiledContentPack;
let baseProjection: GameplayProjection;

const SEED = [11, 22, 33, 44] as const;

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
  const run = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
  baseProjection = projectGameplayState({ state: run, content: pack });
});

function heroPosition(projection: GameplayProjection): { x: number; y: number } {
  const hero = projection.hero as unknown as { x: number; y: number };
  return { x: hero.x, y: hero.y };
}

function withActorEast(
  projection: GameplayProjection,
  disposition: 'hostile' | 'neutral' | 'friendly',
): GameplayProjection {
  const { x, y } = heroPosition(projection);
  return {
    ...projection,
    actors: [
      ...projection.actors,
      {
        actorId: 'actor.target',
        contentId: null,
        x: x + 1,
        y,
        disposition,
        health: 10,
        maxHealth: 10,
      },
    ],
  };
}

function withClosedDoorEast(projection: GameplayProjection): GameplayProjection {
  const { x, y } = heroPosition(projection);
  return {
    ...projection,
    features: [
      ...projection.features,
      { featureId: 'feature.door-1', type: 'door', state: 'closed', x: x + 1, y },
    ],
  };
}

function withLockedDoorEast(projection: GameplayProjection): GameplayProjection {
  const { x, y } = heroPosition(projection);
  return {
    ...projection,
    features: [
      ...projection.features,
      { featureId: 'feature.door-locked-1', type: 'door', state: 'locked', x: x + 1, y },
    ],
  };
}

function withLockedChestSouth(projection: GameplayProjection): GameplayProjection {
  const { x, y } = heroPosition(projection);
  return {
    ...projection,
    features: [
      ...projection.features,
      { featureId: 'feature.chest-locked-1', type: 'chest', state: 'locked', x, y: y + 1 },
    ],
  };
}

function withGroundItemUnderHero(projection: GameplayProjection): GameplayProjection {
  const { x, y } = heroPosition(projection);
  return {
    ...projection,
    groundItems: [
      ...projection.groundItems,
      {
        itemId: 'item.on-floor',
        contentId: 'item.iron-sword',
        name: 'Iron sword',
        quantity: 1,
        x,
        y,
      },
    ],
  };
}

function withStairDownUnderHero(projection: GameplayProjection): GameplayProjection {
  const { x, y } = heroPosition(projection);
  return {
    ...projection,
    floor: {
      ...projection.floor,
      cells: projection.floor.cells.map((cell) =>
        cell.x === x && cell.y === y ? { ...cell, tileId: 5 as const } : cell,
      ),
    },
  };
}

function withStairUpUnderHero(projection: GameplayProjection): GameplayProjection {
  const { x, y } = heroPosition(projection);
  return {
    ...projection,
    floor: {
      ...projection.floor,
      cells: projection.floor.cells.map((cell) =>
        cell.x === x && cell.y === y ? { ...cell, tileId: 4 as const } : cell,
      ),
    },
  };
}

function houseDoorSlot(projection: GameplayProjection): { x: number; y: number } {
  const slots = projection.slots as unknown as readonly {
    tags: readonly string[];
    x: number;
    y: number;
  }[];
  const found = slots.find((slot) => slot.tags.includes('house-door'));
  if (!found) throw new Error('test fixture town projection is missing its house-door slot');
  return { x: found.x, y: found.y };
}

function withHeroAt(projection: GameplayProjection, x: number, y: number): GameplayProjection {
  return { ...projection, hero: { ...projection.hero, x, y } };
}

interface ProjectedMerchantActor {
  readonly actorId: string;
  readonly x: number;
  readonly y: number;
  readonly factionName?: string;
}

function firstMerchantActor(projection: GameplayProjection): ProjectedMerchantActor {
  const merchant = (projection.actors as unknown as readonly ProjectedMerchantActor[]).find(
    (actor) => typeof actor.factionName === 'string',
  );
  if (!merchant) throw new Error('test fixture town projection is missing a merchant actor');
  return merchant;
}

function withActiveTrade(
  projection: GameplayProjection,
  overrides: Partial<NonNullable<GameplayProjection['trade']>> = {},
): GameplayProjection {
  return {
    ...projection,
    trade: {
      merchantPopulationId: 'population.town-provisioner',
      merchantActorId: 'actor.population.town-provisioner.001',
      merchantName: 'Provisioner',
      factionName: 'Provisioners Guild',
      reputationTier: 'neutral',
      currency: 100,
      stock: [],
      saleOffers: [],
      services: [],
      ...overrides,
    },
  };
}

describe('buildIntent', () => {
  it('builds a move command for an empty walkable target', () => {
    const built = buildIntent({
      intent: { type: 'move', direction: 'east' },
      projection: baseProjection,
      commandId: 'command.guest-000001',
      expectedRevision: 0,
    });
    expect(built).toEqual({
      kind: 'command',
      command: {
        type: 'move',
        direction: 'east',
        commandId: 'command.guest-000001',
        expectedRevision: 0,
      },
    });
  });

  it('builds an attack when a hostile actor occupies the target cell', () => {
    const projection = withActorEast(baseProjection, 'hostile');
    const built = buildIntent({
      intent: { type: 'move', direction: 'east' },
      projection,
      commandId: 'command.guest-000002',
      expectedRevision: 1,
    });
    expect(built).toEqual({
      kind: 'command',
      command: {
        type: 'attack',
        targetActorId: 'actor.target',
        commandId: 'command.guest-000002',
        expectedRevision: 1,
      },
    });
  });

  it('builds open-door when a visible closed door occupies the target cell', () => {
    const projection = withClosedDoorEast(baseProjection);
    const built = buildIntent({
      intent: { type: 'move', direction: 'east' },
      projection,
      commandId: 'command.guest-000003',
      expectedRevision: 2,
    });
    expect(built).toEqual({
      kind: 'command',
      command: {
        type: 'open-door',
        featureId: 'feature.door-1',
        commandId: 'command.guest-000003',
        expectedRevision: 2,
      },
    });
  });

  it('blocks a move into a locked door: rejects without dispatching any command (never auto-picks)', () => {
    const projection = withLockedDoorEast(baseProjection);
    const built = buildIntent({
      intent: { type: 'move', direction: 'east' },
      projection,
      commandId: 'command.guest-lock-001',
      expectedRevision: 2,
    });
    expect(built.kind).toBe('rejected');
    expect((built as { message: string }).message).toMatch(/locked/i);
  });

  it('builds pick-lock against the adjacent locked door/chest, and rejects when none is adjacent', () => {
    const withDoor = withLockedDoorEast(baseProjection);
    const built = buildIntent({
      intent: { type: 'pick-lock' },
      projection: withDoor,
      commandId: 'command.guest-lock-002',
      expectedRevision: 3,
    });
    expect(built).toEqual({
      kind: 'command',
      command: {
        type: 'pick-lock',
        featureId: 'feature.door-locked-1',
        commandId: 'command.guest-lock-002',
        expectedRevision: 3,
      },
    });

    const withChest = withLockedChestSouth(baseProjection);
    const builtChest = buildIntent({
      intent: { type: 'pick-lock' },
      projection: withChest,
      commandId: 'command.guest-lock-003',
      expectedRevision: 3,
    });
    expect(builtChest).toEqual({
      kind: 'command',
      command: {
        type: 'pick-lock',
        featureId: 'feature.chest-locked-1',
        commandId: 'command.guest-lock-003',
        expectedRevision: 3,
      },
    });

    const rejected = buildIntent({
      intent: { type: 'pick-lock' },
      projection: baseProjection,
      commandId: 'command.guest-lock-004',
      expectedRevision: 3,
    });
    expect(rejected.kind).toBe('rejected');
  });

  it('builds pickup for the top ground item under the hero with its full quantity', () => {
    const projection = withGroundItemUnderHero(baseProjection);
    const built = buildIntent({
      intent: { type: 'pickup' },
      projection,
      commandId: 'command.guest-000004',
      expectedRevision: 3,
    });
    expect(built).toEqual({
      kind: 'command',
      command: {
        type: 'pickup',
        itemId: 'item.on-floor',
        quantity: 1,
        commandId: 'command.guest-000004',
        expectedRevision: 3,
      },
    });
  });

  it('rejects pickup with a message when nothing lies under the hero', () => {
    const built = buildIntent({
      intent: { type: 'pickup' },
      projection: baseProjection,
      commandId: 'command.guest-000005',
      expectedRevision: 4,
    });
    expect(built.kind).toBe('rejected');
    expect((built as { message: string }).message).toMatch(/nothing here/i);
  });

  it('builds rest until healed with the survival cap', () => {
    const built = buildIntent({
      intent: { type: 'rest' },
      projection: baseProjection,
      commandId: 'command.guest-000006',
      expectedRevision: 5,
    });
    expect(built).toEqual({
      kind: 'command',
      command: {
        type: 'rest',
        until: 'healed',
        maximumDuration: 500,
        commandId: 'command.guest-000006',
        expectedRevision: 5,
      },
    });
  });

  it('returns descend marker only when the hero stands on the stair-down cell, else rejects', () => {
    const onStairs = withStairDownUnderHero(baseProjection);
    const built = buildIntent({
      intent: { type: 'descend' },
      projection: onStairs,
      commandId: 'command.guest-000007',
      expectedRevision: 6,
    });
    expect(built).toEqual({ kind: 'descend' });

    const notOnStairs = buildIntent({
      intent: { type: 'descend' },
      projection: baseProjection,
      commandId: 'command.guest-000008',
      expectedRevision: 6,
    });
    expect(notOnStairs.kind).toBe('rejected');
  });

  it('builds equip with the definition slot, use-item with null target, drop quantity 1, toggle-light flipping enabled', () => {
    const backpack = baseProjection.hero as unknown as {
      backpack: readonly Readonly<Record<string, unknown>>[];
    };
    const ration = backpack.backpack.find((item) => item.contentId === 'item.travel-ration')!;

    const use = buildIntent({
      intent: { type: 'backpack', action: 'use', itemId: ration.itemId as string },
      projection: baseProjection,
      commandId: 'command.guest-000009',
      expectedRevision: 7,
    });
    expect(use).toEqual({
      kind: 'command',
      command: {
        type: 'use-item',
        itemId: ration.itemId,
        target: null,
        commandId: 'command.guest-000009',
        expectedRevision: 7,
      },
    });

    const drop = buildIntent({
      intent: { type: 'backpack', action: 'drop', itemId: ration.itemId as string },
      projection: baseProjection,
      commandId: 'command.guest-000010',
      expectedRevision: 8,
    });
    expect(drop).toEqual({
      kind: 'command',
      command: {
        type: 'drop',
        itemId: ration.itemId,
        quantity: 1,
        commandId: 'command.guest-000010',
        expectedRevision: 8,
      },
    });

    const equippedTorch = baseProjection.hero as unknown as {
      equipment: Readonly<Record<string, Readonly<Record<string, unknown>> | null>>;
    };
    const torch = equippedTorch.equipment['off-hand']!;
    const toggle = buildIntent({
      intent: { type: 'backpack', action: 'toggle-light', itemId: torch.itemId as string },
      projection: baseProjection,
      commandId: 'command.guest-000011',
      expectedRevision: 9,
      pack,
    });
    expect(toggle).toEqual({
      kind: 'command',
      command: {
        type: 'toggle-light',
        itemId: torch.itemId,
        enabled: false,
        commandId: 'command.guest-000011',
        expectedRevision: 9,
      },
    });

    const bow = {
      itemId: 'item.on-floor-bow',
      contentId: 'item.hunting-bow',
      name: 'Hunting bow',
      quantity: 1,
      identified: true,
    };
    const projectionWithBow: GameplayProjection = {
      ...baseProjection,
      hero: { ...baseProjection.hero, backpack: [...backpack.backpack, bow] },
    };
    const equip = buildIntent({
      intent: { type: 'backpack', action: 'equip', itemId: bow.itemId },
      projection: projectionWithBow,
      commandId: 'command.guest-000012',
      expectedRevision: 10,
      pack,
    });
    expect(equip).toEqual({
      kind: 'command',
      command: {
        type: 'equip',
        itemId: bow.itemId,
        slot: 'main-hand',
        commandId: 'command.guest-000012',
        expectedRevision: 10,
      },
    });
  });

  it('builds a refuel command from a fuel intent, targeting the equipped light with the fuel stack quantity', () => {
    // The default guest hero equips a pitch torch (fuelTags: []) and carries no lamp oil, so a
    // brass lantern + lamp oil pairing is grafted onto the base projection here.
    const oil = {
      itemId: 'item.oil-stack',
      contentId: 'item.lamp-oil',
      name: 'Lamp oil',
      quantity: 5,
      identified: true,
    };
    const lantern = {
      itemId: 'item.lantern-1',
      contentId: 'item.brass-lantern',
      name: 'Brass lantern',
      identified: true,
    };
    const projectionWithFuel: GameplayProjection = {
      ...baseProjection,
      hero: {
        ...baseProjection.hero,
        backpack: [oil],
        equipment: {
          ...(baseProjection.hero as unknown as { equipment: Readonly<Record<string, unknown>> })
            .equipment,
          'off-hand': lantern,
        },
      },
    };

    const built = buildIntent({
      intent: { type: 'refuel', fuelItemId: oil.itemId, targetItemId: lantern.itemId },
      projection: projectionWithFuel,
      commandId: 'command.guest-000050',
      expectedRevision: 5,
    });
    expect(built).toEqual({
      kind: 'command',
      command: {
        type: 'refuel',
        itemId: lantern.itemId,
        fuelItemId: oil.itemId,
        quantity: oil.quantity,
        commandId: 'command.guest-000050',
        expectedRevision: 5,
      },
    });
  });

  it('builds an unequip command for an equipped item, finding its slot from the projection', () => {
    const equipment = (
      baseProjection.hero as unknown as {
        equipment: Readonly<Record<string, Readonly<{ itemId: string }> | null>>;
      }
    ).equipment;
    const sword = equipment['main-hand']!;
    const built = buildIntent({
      intent: { type: 'backpack', action: 'unequip', itemId: sword.itemId },
      projection: baseProjection,
      commandId: 'command.guest-000099',
      expectedRevision: 42,
      pack,
    });
    expect(built).toEqual({
      kind: 'command',
      command: {
        type: 'unequip',
        slot: 'main-hand',
        commandId: 'command.guest-000099',
        expectedRevision: 42,
      },
    });
  });

  it('rejects equip of a non-equipment item with the item name in the message', () => {
    const backpack = baseProjection.hero as unknown as {
      backpack: readonly Readonly<Record<string, unknown>>[];
    };
    const ration = backpack.backpack.find((item) => item.contentId === 'item.travel-ration')!;
    const built = buildIntent({
      intent: { type: 'backpack', action: 'equip', itemId: ration.itemId as string },
      projection: baseProjection,
      commandId: 'command.guest-000013',
      expectedRevision: 11,
      pack,
    });
    expect(built.kind).toBe('rejected');
    expect((built as { message: string }).message).toMatch(/travel ration/i);
  });

  it('returns ascend marker only when the hero stands on the stair-up cell, else rejects', () => {
    const onStairs = withStairUpUnderHero(baseProjection);
    const built = buildIntent({
      intent: { type: 'ascend' },
      projection: onStairs,
      commandId: 'command.guest-000014',
      expectedRevision: 12,
    });
    expect(built).toEqual({ kind: 'ascend' });

    const notOnStairs = buildIntent({
      intent: { type: 'ascend' },
      projection: baseProjection,
      commandId: 'command.guest-000015',
      expectedRevision: 12,
    });
    expect(notOnStairs.kind).toBe('rejected');
  });

  it('returns house marker only when the hero is Chebyshev-adjacent to the house-door slot, else rejects', () => {
    const door = houseDoorSlot(baseProjection);
    const adjacent = withHeroAt(baseProjection, door.x + 1, door.y + 1);
    const built = buildIntent({
      intent: { type: 'house' },
      projection: adjacent,
      commandId: 'command.guest-000016',
      expectedRevision: 13,
    });
    expect(built).toEqual({ kind: 'house' });

    const far = withHeroAt(baseProjection, door.x + 5, door.y);
    const rejected = buildIntent({
      intent: { type: 'house' },
      projection: far,
      commandId: 'command.guest-000017',
      expectedRevision: 13,
    });
    expect(rejected.kind).toBe('rejected');

    const onTopOfDoor = withHeroAt(baseProjection, door.x, door.y);
    expect(
      buildIntent({
        intent: { type: 'house' },
        projection: onTopOfDoor,
        commandId: 'command.guest-000018',
        expectedRevision: 13,
      }).kind,
    ).toBe('rejected');
  });

  it('builds house-deposit/house-withdraw commands for house-transfer intents', () => {
    const deposit = buildIntent({
      intent: { type: 'house-transfer', action: 'deposit', itemId: 'item.some-item', quantity: 2 },
      projection: baseProjection,
      commandId: 'command.guest-000019',
      expectedRevision: 14,
    });
    expect(deposit).toEqual({
      kind: 'command',
      command: {
        type: 'house-deposit',
        itemId: 'item.some-item',
        quantity: 2,
        commandId: 'command.guest-000019',
        expectedRevision: 14,
      },
    });

    const withdraw = buildIntent({
      intent: { type: 'house-transfer', action: 'withdraw', itemId: 'item.some-item', quantity: 1 },
      projection: baseProjection,
      commandId: 'command.guest-000020',
      expectedRevision: 15,
    });
    expect(withdraw).toEqual({
      kind: 'command',
      command: {
        type: 'house-withdraw',
        itemId: 'item.some-item',
        quantity: 1,
        commandId: 'command.guest-000020',
        expectedRevision: 15,
      },
    });
  });

  it('builds trade-open only when the hero is Chebyshev-adjacent to a merchant actor, else rejects', () => {
    const merchant = firstMerchantActor(baseProjection);
    const adjacent = withHeroAt(baseProjection, merchant.x - 1, merchant.y - 1);
    const built = buildIntent({
      intent: { type: 'trade-open' },
      projection: adjacent,
      commandId: 'command.guest-000021',
      expectedRevision: 16,
    });
    expect(built).toEqual({
      kind: 'command',
      command: {
        type: 'trade-open',
        merchantActorId: merchant.actorId,
        commandId: 'command.guest-000021',
        expectedRevision: 16,
      },
    });

    const far = withHeroAt(baseProjection, merchant.x + 5, merchant.y);
    const rejected = buildIntent({
      intent: { type: 'trade-open' },
      projection: far,
      commandId: 'command.guest-000022',
      expectedRevision: 16,
    });
    expect(rejected.kind).toBe('rejected');

    const onTopOfMerchant = withHeroAt(baseProjection, merchant.x, merchant.y);
    expect(
      buildIntent({
        intent: { type: 'trade-open' },
        projection: onTopOfMerchant,
        commandId: 'command.guest-000023',
        expectedRevision: 16,
      }).kind,
    ).toBe('rejected');
  });

  it('rejects trade-buy/trade-sell/trade-service/trade-close when no trade session is open', () => {
    const buy = buildIntent({
      intent: { type: 'trade-buy', itemId: 'item.some-stock', quantity: 1 },
      projection: baseProjection,
      commandId: 'command.guest-000024',
      expectedRevision: 17,
    });
    expect(buy.kind).toBe('rejected');

    const sell = buildIntent({
      intent: { type: 'trade-sell', itemId: 'item.some-offer', quantity: 1 },
      projection: baseProjection,
      commandId: 'command.guest-000025',
      expectedRevision: 17,
    });
    expect(sell.kind).toBe('rejected');

    const service = buildIntent({
      intent: {
        type: 'trade-service',
        serviceId: 'merchant-service.strongbox',
        targetItemId: null,
      },
      projection: baseProjection,
      commandId: 'command.guest-000026',
      expectedRevision: 17,
    });
    expect(service.kind).toBe('rejected');

    const close = buildIntent({
      intent: { type: 'trade-close' },
      projection: baseProjection,
      commandId: 'command.guest-000027',
      expectedRevision: 17,
    });
    expect(close.kind).toBe('rejected');
  });

  it("builds trade-buy/trade-sell/trade-service/trade-close against the open session's merchant population", () => {
    const projection = withActiveTrade(baseProjection);

    const buy = buildIntent({
      intent: { type: 'trade-buy', itemId: 'item.some-stock', quantity: 2 },
      projection,
      commandId: 'command.guest-000028',
      expectedRevision: 18,
    });
    expect(buy).toEqual({
      kind: 'command',
      command: {
        type: 'trade-buy',
        merchantPopulationId: 'population.town-provisioner',
        itemId: 'item.some-stock',
        quantity: 2,
        commandId: 'command.guest-000028',
        expectedRevision: 18,
      },
    });

    const sell = buildIntent({
      intent: { type: 'trade-sell', itemId: 'item.some-offer', quantity: 1 },
      projection,
      commandId: 'command.guest-000029',
      expectedRevision: 18,
    });
    expect(sell).toEqual({
      kind: 'command',
      command: {
        type: 'trade-sell',
        merchantPopulationId: 'population.town-provisioner',
        itemId: 'item.some-offer',
        quantity: 1,
        commandId: 'command.guest-000029',
        expectedRevision: 18,
      },
    });

    const service = buildIntent({
      intent: {
        type: 'trade-service',
        serviceId: 'merchant-service.strongbox',
        targetItemId: null,
      },
      projection,
      commandId: 'command.guest-000030',
      expectedRevision: 18,
    });
    expect(service).toEqual({
      kind: 'command',
      command: {
        type: 'trade-service',
        merchantPopulationId: 'population.town-provisioner',
        serviceId: 'merchant-service.strongbox',
        targetItemId: null,
        commandId: 'command.guest-000030',
        expectedRevision: 18,
      },
    });

    const identifyService = buildIntent({
      intent: {
        type: 'trade-service',
        serviceId: 'merchant-service.identify',
        targetItemId: 'item.mystery',
      },
      projection,
      commandId: 'command.guest-000031',
      expectedRevision: 18,
    });
    expect(identifyService).toEqual({
      kind: 'command',
      command: {
        type: 'trade-service',
        merchantPopulationId: 'population.town-provisioner',
        serviceId: 'merchant-service.identify',
        targetItemId: 'item.mystery',
        commandId: 'command.guest-000031',
        expectedRevision: 18,
      },
    });

    const close = buildIntent({
      intent: { type: 'trade-close' },
      projection,
      commandId: 'command.guest-000032',
      expectedRevision: 18,
    });
    expect(close).toEqual({
      kind: 'command',
      command: {
        type: 'trade-close',
        merchantPopulationId: 'population.town-provisioner',
        commandId: 'command.guest-000032',
        expectedRevision: 18,
      },
    });
  });

  it('builds a cast command with the spellId and cell-based target', () => {
    const built = buildIntent({
      intent: { type: 'cast', spellId: 'spell.ember-bolt', target: { x: 3, y: 4 } },
      projection: baseProjection,
      commandId: 'command.guest-000033',
      expectedRevision: 19,
    });
    expect(built).toEqual({
      kind: 'command',
      command: {
        type: 'cast',
        spellId: 'spell.ember-bolt',
        target: { x: 3, y: 4 },
        commandId: 'command.guest-000033',
        expectedRevision: 19,
      },
    });
  });
});
